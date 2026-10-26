import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_FIREWORKS_MODEL } from "@/lib/ai/providers/fireworks-config";
import {
  clearAiOverrides,
  getAiOverrides,
  getServerKeysStatus,
  resolveEffectiveConfig,
  saveAiOverrides,
} from "@/lib/settings/ai-settings";

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

type Row = Record<string, unknown>;

type FakeAdmin = {
  rows: Row[];
  upserts: Array<{ row: Row; options: unknown }>;
  error: { message: string } | null;
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        maybeSingle: () => Promise<{
          data: Row | null;
          error: { message: string } | null;
        }>;
      };
    };
    upsert: (
      row: Row,
      options?: unknown,
    ) => Promise<{ error: { message: string } | null }>;
    update: (patch: Row) => {
      eq: (
        column: string,
        value: unknown,
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

function createFakeAdmin(initial: Row[] = []): FakeAdmin {
  const rows = initial.map((row) => ({ ...row }));
  const upserts: FakeAdmin["upserts"] = [];

  const fake: FakeAdmin = {
    rows,
    upserts,
    error: null,
    from(table) {
      if (table !== "app_settings") {
        throw new Error(`tabela inesperada: ${table}`);
      }
      return {
        select: (columns) => ({
          eq: (column, value) => ({
            maybeSingle: async () => {
              if (fake.error) return { data: null, error: fake.error };
              const row = rows.find((candidate) => candidate[column] === value);
              if (!row) return { data: null, error: null };
              const selected: Row = {};
              for (const name of columns.split(",").map((part) => part.trim())) {
                selected[name] = row[name];
              }
              return { data: selected, error: null };
            },
          }),
        }),
        upsert: async (row, options) => {
          if (fake.error) return { error: fake.error };
          upserts.push({ row: { ...row }, options });
          const index = rows.findIndex((candidate) => candidate.key === row.key);
          if (index === -1) rows.push({ ...row });
          else rows[index] = { ...rows[index], ...row };
          return { error: null };
        },
        update: (patch) => ({
          eq: async (column, value) => {
            if (fake.error) return { error: fake.error };
            for (const row of rows) {
              if (row[column] === value) Object.assign(row, patch);
            }
            return { error: null };
          },
        }),
      };
    },
  };

  return fake;
}

let admin: FakeAdmin;

beforeEach(() => {
  admin = createFakeAdmin();
  mocks.admin = admin;
  vi.stubEnv("AI_PROVIDER", undefined);
  vi.stubEnv("FIREWORKS_MODEL", undefined);
  vi.stubEnv("OPENROUTER_MODEL", undefined);
  vi.stubEnv("FIREWORKS_API_KEY", undefined);
  vi.stubEnv("OPENROUTER_API_KEY", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("saveAiOverrides", () => {
  it("grava o par Fireworks + modelo padrão", async () => {
    const config = await saveAiOverrides(
      { provider: "fireworks", model: DEFAULT_FIREWORKS_MODEL },
      "user-1",
    );

    expect(config).toEqual({
      provider: "fireworks",
      model: DEFAULT_FIREWORKS_MODEL,
      source: "global",
    });
    expect(admin.upserts).toHaveLength(1);
    expect(admin.upserts[0]?.row).toEqual({
      key: "ai",
      provider: "fireworks",
      model: DEFAULT_FIREWORKS_MODEL,
      updated_by: "user-1",
    });
    expect(admin.upserts[0]?.options).toEqual({ onConflict: "key" });
  });

  it("grava o par OpenRouter + modelo do catálogo", async () => {
    const config = await saveAiOverrides({
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
    });

    expect(config).toEqual({
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
      source: "global",
    });
    expect(admin.rows[0]).toMatchObject({
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
      updated_by: null,
    });
  });

  it("aceita modelo custom do Fireworks com o prefixo do provedor", async () => {
    const model = "accounts/fireworks/models/novo-alias";

    await expect(
      saveAiOverrides({ provider: "fireworks", model }),
    ).resolves.toMatchObject({ provider: "fireworks", model });
  });

  it("aceita modelo custom do OpenRouter com slug ~provider/modelo", async () => {
    const model = "~anthropic/claude-sonnet-4";

    await expect(
      saveAiOverrides({ provider: "openrouter", model }),
    ).resolves.toMatchObject({ provider: "openrouter", model });
  });

  it("aceita modelo custom do OpenRouter com / no id", async () => {
    const model = "google/gemini-3-pro";

    await expect(
      saveAiOverrides({ provider: "openrouter", model }),
    ).resolves.toMatchObject({ provider: "openrouter", model });
  });

  it("rejeita modelo do OpenRouter no provedor Fireworks", async () => {
    await expect(
      saveAiOverrides({ provider: "fireworks", model: "meta/muse-spark-1.3" }),
    ).rejects.toThrow("Modelo não pertence ao provedor selecionado");
    expect(admin.upserts).toHaveLength(0);
  });

  it("rejeita modelo do Fireworks no provedor OpenRouter", async () => {
    await expect(
      saveAiOverrides({
        provider: "openrouter",
        model: "accounts/fireworks/routers/glm-flash-latest",
      }),
    ).rejects.toThrow("Modelo não pertence ao provedor selecionado");
    expect(admin.upserts).toHaveLength(0);
  });

  it("rejeita modelo custom sem prefixo no Fireworks", async () => {
    await expect(
      saveAiOverrides({ provider: "fireworks", model: "deepseek-flash-latest" }),
    ).rejects.toThrow("Modelo não pertence ao provedor selecionado");
  });

  it("rejeita provider desconhecido", async () => {
    await expect(
      saveAiOverrides({
        provider: "opencode" as unknown as "fireworks",
        model: "modelo-x",
      }),
    ).rejects.toThrow("Provedor inválido (use fireworks ou openrouter)");
    expect(admin.upserts).toHaveLength(0);
  });

  it("rejeita modelo vazio", async () => {
    await expect(
      saveAiOverrides({ provider: "fireworks", model: "   " }),
    ).rejects.toThrow("Modelo é obrigatório");
  });

  it("rejeita modelo acima de 200 caracteres", async () => {
    await expect(
      saveAiOverrides({
        provider: "fireworks",
        model: `accounts/fireworks/${"a".repeat(200)}`,
      }),
    ).rejects.toThrow("Modelo muito longo");
  });

  it("aceita provider sem modelo (usa o padrão do servidor)", async () => {
    const config = await saveAiOverrides({ provider: "openrouter" });

    expect(config).toMatchObject({ provider: "openrouter", source: "global" });
    expect(admin.upserts[0]?.row).toMatchObject({ model: null });
  });

  it("propaga erro do banco ao salvar", async () => {
    admin.error = { message: "constraint violation" };

    await expect(
      saveAiOverrides({ provider: "fireworks", model: DEFAULT_FIREWORKS_MODEL }),
    ).rejects.toThrow(
      "Falha ao salvar configurações de IA: constraint violation",
    );
  });
});

describe("getAiOverrides", () => {
  it("retorna a config global salva", async () => {
    admin = createFakeAdmin([
      {
        key: "ai",
        provider: "openrouter",
        model: "meta/muse-spark-1.3",
      },
    ]);
    mocks.admin = admin;

    await expect(getAiOverrides()).resolves.toEqual({
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
    });
  });

  it("retorna vazio quando não há linha", async () => {
    await expect(getAiOverrides()).resolves.toEqual({});
  });

  it("descarta linha com provider legado", async () => {
    admin = createFakeAdmin([
      { key: "ai", provider: "opencode", model: "modelo-antigo" },
    ]);
    mocks.admin = admin;

    await expect(getAiOverrides()).resolves.toEqual({});
  });

  it("propaga erro de leitura", async () => {
    admin.error = { message: "select failed" };

    await expect(getAiOverrides()).rejects.toThrow(
      "Falha ao ler configurações de IA: select failed",
    );
  });
});

describe("clearAiOverrides", () => {
  it("zera provider/model e volta ao padrão do servidor", async () => {
    admin = createFakeAdmin([
      { key: "ai", provider: "openrouter", model: "meta/muse-spark-1.3" },
    ]);
    mocks.admin = admin;

    const config = await clearAiOverrides();

    expect(admin.rows[0]).toMatchObject({
      provider: null,
      model: null,
      updated_by: null,
    });
    expect(config).toEqual({
      provider: "fireworks",
      model: DEFAULT_FIREWORKS_MODEL,
      source: "env",
    });
  });

  it("propaga erro ao redefinir", async () => {
    admin.error = { message: "update failed" };

    await expect(clearAiOverrides()).rejects.toThrow(
      "Falha ao redefinir configurações de IA: update failed",
    );
  });
});

describe("resolveEffectiveConfig", () => {
  it("usa o padrão Fireworks do env sem overrides", () => {
    expect(resolveEffectiveConfig({})).toEqual({
      provider: "fireworks",
      model: DEFAULT_FIREWORKS_MODEL,
      source: "env",
    });
  });

  it("respeita AI_PROVIDER=openrouter no env", () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");
    vi.stubEnv("OPENROUTER_MODEL", "meta/muse-spark-1.3");

    expect(resolveEffectiveConfig({})).toEqual({
      provider: "openrouter",
      model: "meta/muse-spark-1.3",
      source: "env",
    });
  });

  it("marca como global quando há override", () => {
    vi.stubEnv("AI_PROVIDER", "openrouter");

    expect(
      resolveEffectiveConfig({ provider: "fireworks", model: "modelo-x" }),
    ).toEqual({
      provider: "fireworks",
      model: "modelo-x",
      source: "global",
    });
  });
});

describe("getServerKeysStatus", () => {
  it("reporta as duas chaves ausentes", () => {
    expect(getServerKeysStatus()).toEqual({
      fireworksConfigured: false,
      openrouterConfigured: false,
    });
  });

  it("reporta chave do Fireworks configurada", () => {
    vi.stubEnv("FIREWORKS_API_KEY", "  fw-exemplo  ");

    expect(getServerKeysStatus()).toEqual({
      fireworksConfigured: true,
      openrouterConfigured: false,
    });
  });

  it("reporta as duas chaves configuradas", () => {
    vi.stubEnv("FIREWORKS_API_KEY", "fw-exemplo");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-v1-exemplo");

    expect(getServerKeysStatus()).toEqual({
      fireworksConfigured: true,
      openrouterConfigured: true,
    });
  });

  it("ignora chave só com espaços", () => {
    vi.stubEnv("FIREWORKS_API_KEY", "   ");

    expect(getServerKeysStatus().fireworksConfigured).toBe(false);
  });
});
