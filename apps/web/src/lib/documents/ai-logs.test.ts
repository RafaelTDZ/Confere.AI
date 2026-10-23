import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  attachAiLogsToImport,
  getMonthlyTokenUsage,
  persistAiLog,
} from "@/lib/documents/ai-logs";
import { FakeSupabase, type FakeRow } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
  readClient: undefined as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

vi.mock("@/lib/supabase/read-client", () => ({
  getReadClient: async () => mocks.readClient,
}));

let admin: FakeSupabase;

beforeEach(() => {
  admin = new FakeSupabase({ ai_logs: [] });
  mocks.admin = admin;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createReadClient(result: {
  data: Array<{ tokens_in: number | null; tokens_out: number | null }> | null;
  error: { message: string } | null;
}) {
  const gte = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ gte });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });

  return { from, select, eq, gte };
}

function baseParams() {
  return {
    tenantId: "tenant-a",
    capability: "extract_invoice",
    model: "modelo-teste",
    tokensIn: 120,
    tokensOut: 40,
    latencyMs: 850,
    status: "success" as const,
  };
}

function logRows(): FakeRow[] {
  return admin.rows("ai_logs");
}

describe("persistAiLog", () => {
  it("insere todos os campos informados e retorna o id", async () => {
    const id = await persistAiLog({
      ...baseParams(),
      errorMessage: "aviso",
      costUsd: 0.0042,
      reasoningTokens: 17,
      importId: "import-1",
    });

    expect(logRows()).toHaveLength(1);
    expect(logRows()[0]).toMatchObject({
      tenant_id: "tenant-a",
      capability: "extract_invoice",
      model: "modelo-teste",
      tokens_in: 120,
      tokens_out: 40,
      latency_ms: 850,
      status: "success",
      error_message: "aviso",
      cost_usd: 0.0042,
      reasoning_tokens: 17,
      import_id: "import-1",
    });
    expect(id).toEqual(expect.any(String));
    expect(id).toBe(logRows()[0]?.id);
  });

  it("aplica os defaults dos campos opcionais", async () => {
    await persistAiLog(baseParams());

    expect(logRows()[0]).toMatchObject({
      error_message: null,
      cost_usd: null,
      reasoning_tokens: 0,
      import_id: null,
    });
  });

  it("não propaga erro do client e registra no console", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const failure = new Error("client indisponível");
    mocks.admin = {
      from() {
        throw failure;
      },
    };

    await expect(persistAiLog(baseParams())).resolves.toBeNull();

    expect(errorSpy).toHaveBeenCalledWith(
      "[ai_logs] falha ao persistir:",
      failure,
    );
    expect(logRows()).toHaveLength(0);
  });

  it("retorna null quando o insert responde com erro", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    admin.failNext("insert recusado", { table: "ai_logs", operation: "insert" });

    await expect(persistAiLog(baseParams())).resolves.toBeNull();

    expect(errorSpy).toHaveBeenCalledWith(
      "[ai_logs] falha ao persistir:",
      { message: "insert recusado" },
    );
    expect(logRows()).toHaveLength(0);
  });

  it("retorna null quando o insert não devolve id", async () => {
    mocks.admin = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };

    await expect(persistAiLog(baseParams())).resolves.toBeNull();
  });
});

describe("getMonthlyTokenUsage", () => {
  it("soma tokens de entrada e saída do tenant no mês atual UTC", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    const readClient = createReadClient({
      data: [
        { tokens_in: 120, tokens_out: 40 },
        { tokens_in: 10, tokens_out: 5 },
      ],
      error: null,
    });
    mocks.readClient = readClient;

    await expect(getMonthlyTokenUsage("tenant-a")).resolves.toBe(175);

    expect(readClient.from).toHaveBeenCalledWith("ai_logs");
    expect(readClient.select).toHaveBeenCalledWith("tokens_in, tokens_out");
    expect(readClient.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(readClient.gte).toHaveBeenCalledWith(
      "created_at",
      "2026-10-01T00:00:00.000Z",
    );
  });

  it("trata tokens nulos como zero", async () => {
    mocks.readClient = createReadClient({
      data: [
        { tokens_in: null, tokens_out: 20 },
        { tokens_in: 5, tokens_out: null },
      ],
      error: null,
    });

    await expect(getMonthlyTokenUsage("tenant-a")).resolves.toBe(25);
  });

  it("retorna 0 quando não há logs no mês", async () => {
    mocks.readClient = createReadClient({ data: null, error: null });

    await expect(getMonthlyTokenUsage("tenant-a")).resolves.toBe(0);
  });

  it("propaga o erro quando a consulta falha", async () => {
    mocks.readClient = createReadClient({
      data: null,
      error: { message: "consulta recusada" },
    });

    await expect(getMonthlyTokenUsage("tenant-a")).rejects.toThrow(
      "consulta recusada",
    );
  });

  it("usa a mensagem padrão quando o erro vem sem texto", async () => {
    mocks.readClient = createReadClient({
      data: null,
      error: { message: "" },
    });

    await expect(getMonthlyTokenUsage("tenant-a")).rejects.toThrow(
      "Falha ao calcular uso mensal de IA",
    );
  });
});

describe("attachAiLogsToImport", () => {
  beforeEach(() => {
    admin.rows("ai_logs").push(
      { id: "log-1", tenant_id: "tenant-a", import_id: null },
      { id: "log-2", tenant_id: "tenant-a", import_id: null },
      { id: "log-3", tenant_id: "tenant-b", import_id: null },
    );
  });

  it("vincula somente os logs informados do tenant", async () => {
    await attachAiLogsToImport({
      tenantId: "tenant-a",
      importId: "import-1",
      logIds: ["log-1", "log-2"],
    });

    expect(logRows()).toEqual([
      { id: "log-1", tenant_id: "tenant-a", import_id: "import-1" },
      { id: "log-2", tenant_id: "tenant-a", import_id: "import-1" },
      { id: "log-3", tenant_id: "tenant-b", import_id: null },
    ]);

    expect(admin.queries).toEqual([
      {
        table: "ai_logs",
        operation: "update",
        filters: [
          { column: "tenant_id", operator: "eq", value: "tenant-a" },
          { column: "id", operator: "in", value: ["log-1", "log-2"] },
        ],
      },
    ]);
  });

  it("não consulta o banco quando a lista de ids está vazia", async () => {
    await attachAiLogsToImport({
      tenantId: "tenant-a",
      importId: "import-1",
      logIds: [],
    });

    expect(admin.queries).toHaveLength(0);
    expect(logRows()[0]).toMatchObject({ import_id: null });
  });

  it("propaga o erro quando a atualização falha", async () => {
    admin.failNext("update recusado", { table: "ai_logs", operation: "update" });

    await expect(
      attachAiLogsToImport({
        tenantId: "tenant-a",
        importId: "import-1",
        logIds: ["log-1"],
      }),
    ).rejects.toThrow("update recusado");

    expect(logRows()[0]).toMatchObject({ import_id: null });
  });

  it("usa a mensagem padrão quando o erro vem sem texto", async () => {
    admin.failNext({ message: "" }, { table: "ai_logs", operation: "update" });

    await expect(
      attachAiLogsToImport({
        tenantId: "tenant-a",
        importId: "import-1",
        logIds: ["log-1"],
      }),
    ).rejects.toThrow("Falha ao vincular logs à importação");
  });
});
