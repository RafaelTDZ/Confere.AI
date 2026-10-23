import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumeRateLimit,
  getAnalyzeRateLimit,
  getAnalyzeRateWindowSeconds,
  getCheckEmailRateLimit,
  getCheckEmailRateWindowSeconds,
  getMonthlyTokenQuota,
} from "@/lib/security/rate-limit";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));

const ENV_KEYS = [
  "AI_ANALYZE_RATE_LIMIT",
  "AI_ANALYZE_RATE_WINDOW_SECONDS",
  "CHECK_EMAIL_RATE_LIMIT",
  "CHECK_EMAIL_RATE_WINDOW_SECONDS",
  "AI_MONTHLY_TOKEN_QUOTA",
] as const;

let envBackup: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockReset();
  envBackup = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]]),
  );
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = envBackup[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function rpcRow(overrides: Record<string, unknown> = {}) {
  return [
    {
      allowed: true,
      remaining: 29,
      reset_at: "2026-10-23T12:05:00.000Z",
      ...overrides,
    },
  ];
}

describe("consumeRateLimit", () => {
  it("repassa os parâmetros ao RPC e devolve o resultado normalizado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    mocks.rpc.mockResolvedValueOnce({ data: rpcRow(), error: null });

    const result = await consumeRateLimit({
      bucket: "analyze:tenant:tenant-1",
      limit: 30,
      windowSeconds: 3600,
    });

    expect(mocks.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_bucket: "analyze:tenant:tenant-1",
      p_window_seconds: 3600,
      p_limit: 30,
    });
    expect(result).toEqual({
      allowed: true,
      remaining: 29,
      resetAt: "2026-10-23T12:05:00.000Z",
      retryAfterSeconds: 300,
    });
  });

  it("devolve resultado coerente quando o limite é atingido", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:00:00.000Z"));
    mocks.rpc.mockResolvedValueOnce({
      data: rpcRow({ allowed: false, remaining: 0 }),
      error: null,
    });

    const result = await consumeRateLimit({
      bucket: "analyze:tenant:tenant-1",
      limit: 1,
      windowSeconds: 60,
    });

    expect(result).toEqual({
      allowed: false,
      remaining: 0,
      resetAt: "2026-10-23T12:05:00.000Z",
      retryAfterSeconds: 300,
    });
  });

  it("nunca devolve retryAfterSeconds negativo", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T12:10:00.000Z"));
    mocks.rpc.mockResolvedValueOnce({
      data: rpcRow({ allowed: true, remaining: 4 }),
      error: null,
    });

    const result = await consumeRateLimit({
      bucket: "analyze:tenant:tenant-1",
      limit: 30,
      windowSeconds: 3600,
    });

    expect(result.retryAfterSeconds).toBe(0);
  });

  it("lança erro com mensagem clara quando o RPC falha", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "relation does not exist" },
    });

    await expect(
      consumeRateLimit({
        bucket: "analyze:tenant:tenant-1",
        limit: 30,
        windowSeconds: 3600,
      }),
    ).rejects.toThrow(
      "Falha ao verificar o rate limit (analyze:tenant:tenant-1): relation does not exist",
    );
  });

  it("lança erro quando o RPC não devolve linhas", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    await expect(
      consumeRateLimit({
        bucket: "analyze:tenant:tenant-1",
        limit: 30,
        windowSeconds: 3600,
      }),
    ).rejects.toThrow(
      "Falha ao verificar o rate limit (analyze:tenant:tenant-1): resposta vazia",
    );
  });

  it("lança erro quando o RPC devolve data nulo", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });

    await expect(
      consumeRateLimit({
        bucket: "analyze:tenant:tenant-1",
        limit: 30,
        windowSeconds: 3600,
      }),
    ).rejects.toThrow(
      "Falha ao verificar o rate limit (analyze:tenant:tenant-1): resposta vazia",
    );
  });

  it("lança erro quando a linha vem incompleta", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: rpcRow({ remaining: null }),
      error: null,
    });

    await expect(
      consumeRateLimit({
        bucket: "analyze:tenant:tenant-1",
        limit: 30,
        windowSeconds: 3600,
      }),
    ).rejects.toThrow(
      "Falha ao verificar o rate limit (analyze:tenant:tenant-1): resposta inválida",
    );
  });

  it("lança erro quando reset_at é inválido", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: rpcRow({ reset_at: "não-é-data" }),
      error: null,
    });

    await expect(
      consumeRateLimit({
        bucket: "analyze:tenant:tenant-1",
        limit: 30,
        windowSeconds: 3600,
      }),
    ).rejects.toThrow(
      "Falha ao verificar o rate limit (analyze:tenant:tenant-1): reset_at inválido",
    );
  });
});

describe("getAnalyzeRateLimit", () => {
  it("usa 30 como default quando a variável não está definida", () => {
    expect(getAnalyzeRateLimit()).toBe(30);
  });

  it("usa o valor do env quando é um inteiro positivo", () => {
    process.env.AI_ANALYZE_RATE_LIMIT = " 7 ";

    expect(getAnalyzeRateLimit()).toBe(7);
  });

  it.each(["0", "-1", "abc", "3.5", ""])(
    "usa o default quando o valor é inválido (%s)",
    (value) => {
      process.env.AI_ANALYZE_RATE_LIMIT = value;

      expect(getAnalyzeRateLimit()).toBe(30);
    },
  );
});

describe("getAnalyzeRateWindowSeconds", () => {
  it("usa 3600 como default quando a variável não está definida", () => {
    expect(getAnalyzeRateWindowSeconds()).toBe(3600);
  });

  it("usa o valor do env quando é um inteiro positivo", () => {
    process.env.AI_ANALYZE_RATE_WINDOW_SECONDS = "60";

    expect(getAnalyzeRateWindowSeconds()).toBe(60);
  });

  it.each(["0", "-30", "uma hora", "1.5", ""])(
    "usa o default quando o valor é inválido (%s)",
    (value) => {
      process.env.AI_ANALYZE_RATE_WINDOW_SECONDS = value;

      expect(getAnalyzeRateWindowSeconds()).toBe(3600);
    },
  );
});

describe("getCheckEmailRateLimit", () => {
  it("usa 10 como default quando a variável não está definida", () => {
    expect(getCheckEmailRateLimit()).toBe(10);
  });

  it("usa o valor do env quando é um inteiro positivo", () => {
    process.env.CHECK_EMAIL_RATE_LIMIT = " 5 ";

    expect(getCheckEmailRateLimit()).toBe(5);
  });

  it.each(["0", "-1", "abc", "2.5", ""])(
    "usa o default quando o valor é inválido (%s)",
    (value) => {
      process.env.CHECK_EMAIL_RATE_LIMIT = value;

      expect(getCheckEmailRateLimit()).toBe(10);
    },
  );
});

describe("getCheckEmailRateWindowSeconds", () => {
  it("usa 60 como default quando a variável não está definida", () => {
    expect(getCheckEmailRateWindowSeconds()).toBe(60);
  });

  it("usa o valor do env quando é um inteiro positivo", () => {
    process.env.CHECK_EMAIL_RATE_WINDOW_SECONDS = "120";

    expect(getCheckEmailRateWindowSeconds()).toBe(120);
  });

  it.each(["0", "-60", "um minuto", "0.5", ""])(
    "usa o default quando o valor é inválido (%s)",
    (value) => {
      process.env.CHECK_EMAIL_RATE_WINDOW_SECONDS = value;

      expect(getCheckEmailRateWindowSeconds()).toBe(60);
    },
  );
});

describe("getMonthlyTokenQuota", () => {
  it("usa 10_000_000 como default quando a variável não está definida", () => {
    expect(getMonthlyTokenQuota()).toBe(10_000_000);
  });

  it("usa o valor do env quando é um inteiro positivo", () => {
    process.env.AI_MONTHLY_TOKEN_QUOTA = "2500000";

    expect(getMonthlyTokenQuota()).toBe(2_500_000);
  });

  it.each(["0", "-100", "muitos", "10.5", ""])(
    "usa o default quando o valor é inválido (%s)",
    (value) => {
      process.env.AI_MONTHLY_TOKEN_QUOTA = value;

      expect(getMonthlyTokenQuota()).toBe(10_000_000);
    },
  );
});
