import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  createTimer,
  currentLogLevel,
  getLogContext,
  isLevelEnabled,
  runWithLogContext,
  serializeError,
} from "@/lib/observability/logger";

type ConsoleMethod = "debug" | "info" | "warn" | "error";

function spyOn(level: ConsoleMethod) {
  return vi.spyOn(console, level).mockImplementation(() => {});
}

function payloadOf(spy: ReturnType<typeof spyOn>): Record<string, unknown> {
  const line = spy.mock.calls.at(-1)?.[0];
  expect(typeof line).toBe("string");
  return JSON.parse(String(line)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubEnv("LOG_LEVEL", "debug");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("emite uma linha JSON com nível, escopo, evento e campos", () => {
    const info = spyOn("info");
    createLogger("analyze-pipeline").info("pipeline_start", {
      importId: "import-1",
      bytes: 1024,
    });

    const payload = payloadOf(info);
    expect(payload).toMatchObject({
      level: "info",
      scope: "analyze-pipeline",
      event: "pipeline_start",
      importId: "import-1",
      bytes: 1024,
    });
    expect(typeof payload.time).toBe("string");
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("usa o console do nível correspondente", () => {
    const warn = spyOn("warn");
    const debug = spyOn("debug");
    const error = spyOn("error");
    const logger = createLogger("tracking");

    logger.warn("blocked");
    logger.debug("claim");
    logger.error("boom");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("descarta logs abaixo de LOG_LEVEL", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    const info = spyOn("info");
    const warn = spyOn("warn");
    const error = spyOn("error");
    const logger = createLogger("api");

    logger.info("entrou");
    logger.warn("quase");
    logger.error("falhou");

    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("silencia tudo com LOG_LEVEL=silent", () => {
    vi.stubEnv("LOG_LEVEL", "silent");
    const error = spyOn("error");

    createLogger("api").error("falhou");

    expect(error).not.toHaveBeenCalled();
    expect(isLevelEnabled("error")).toBe(false);
    expect(currentLogLevel()).toBe("silent");
  });

  it("ignora LOG_LEVEL inválido e usa o default do ambiente", () => {
    vi.stubEnv("LOG_LEVEL", "barulhento");
    expect(currentLogLevel()).toBe("warn");
  });

  it("herda campos de child()", () => {
    const info = spyOn("info");
    createLogger("tracking", { carrier: "maersk" })
      .child({ shipmentId: "ship-1" })
      .info("snapshot_saved", { status: "in_transit" });

    expect(payloadOf(info)).toMatchObject({
      carrier: "maersk",
      shipmentId: "ship-1",
      status: "in_transit",
    });
  });

  it("redige campos sensíveis", () => {
    const error = spyOn("error");
    createLogger("ai").error("provider_failed", {
      apiKey: "fw-123",
      authorization: "Bearer x",
      FIRECRAWL_API_KEY: "fc-123",
      nested: { token: "abc", model: "deepseek" },
      password: "123456",
      access_token: "jwt",
      tokensIn: 120,
      tokens: { in: 120, out: 30 },
    });

    expect(payloadOf(error)).toMatchObject({
      apiKey: "[redacted]",
      authorization: "[redacted]",
      FIRECRAWL_API_KEY: "[redacted]",
      nested: { token: "[redacted]", model: "deepseek" },
      password: "[redacted]",
      access_token: "[redacted]",
      // contagem de tokens não é segredo
      tokensIn: 120,
      tokens: { in: 120, out: 30 },
    });
  });

  it("serializa Error com stack, code e cause", () => {
    const error = spyOn("error");
    const cause = new Error("conexão recusada");
    const failure = Object.assign(new Error("falha ao salvar"), {
      code: "PGRST301",
    });
    failure.cause = cause;

    createLogger("imports").error("persist_failed", { error: failure });

    const serialized = payloadOf(error).error as Record<string, unknown>;
    expect(serialized).toMatchObject({
      name: "Error",
      message: "falha ao salvar",
      code: "PGRST301",
      cause: { name: "Error", message: "conexão recusada" },
    });
    expect(String(serialized.stack)).toContain("falha ao salvar");
  });

  it("trunca strings longas, limita arrays e corta ciclos", () => {
    const info = spyOn("info");
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;

    createLogger("debug").info("dump", {
      markdown: "x".repeat(2_000),
      many: Array.from({ length: 25 }, (_, index) => index),
      circular,
    });

    const payload = payloadOf(info);
    expect(String(payload.markdown)).toHaveLength(1_000 + "…(1000 chars)".length);
    expect(payload.many).toHaveLength(21);
    expect((payload.circular as Record<string, unknown>).self).toBe("[circular]");
  });

  it("não deixa um payload não serializável derrubar o log", () => {
    const error = spyOn("error");
    const logger = createLogger("api");
    const value = { toJSON: () => { throw new Error("nope"); } };
    Object.defineProperty(value, "boom", { get: () => { throw new Error("getter"); }, enumerable: true });

    expect(() => logger.error("weird", { value })).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("runWithLogContext", () => {
  it("herda o contexto e deixa os campos explícitos vencerem", () => {
    const info = spyOn("info");
    const logger = createLogger("pipeline");

    runWithLogContext(
      { tenantId: "tenant-1", importId: "import-1" },
      () => logger.info("stage", { importId: "import-2" }),
    );

    expect(payloadOf(info)).toMatchObject({
      tenantId: "tenant-1",
      importId: "import-2",
    });
  });

  it("propaga o contexto para funções assíncronas encadeadas", async () => {
    const info = spyOn("info");
    const logger = createLogger("worker");

    await runWithLogContext({ jobId: "job-1" }, async () => {
      await Promise.resolve();
      logger.info("claimed");
    });

    expect(payloadOf(info)).toMatchObject({ jobId: "job-1" });
  });

  it("aninha contextos sem vazar entre execuções", async () => {
    const info = spyOn("info");
    const logger = createLogger("worker");

    await runWithLogContext({ tenantId: "t1" }, async () => {
      await runWithLogContext({ importId: "i1" }, () => logger.info("inner"));
    });
    logger.info("outer");

    const calls = info.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(calls[0]).toMatchObject({ tenantId: "t1", importId: "i1" });
    expect(calls[1].importId).toBeUndefined();
    expect(getLogContext()).toEqual({});
  });
});

describe("createTimer", () => {
  it("mede o tempo decorrido em ms", () => {
    vi.useFakeTimers();
    const timer = createTimer();
    vi.advanceTimersByTime(250);
    expect(timer.elapsedMs()).toBeGreaterThanOrEqual(250);
    vi.useRealTimers();
  });
});

describe("serializeError", () => {
  it("aceita string, objeto desconhecido e erro sem stack", () => {
    expect(serializeError("quebrou")).toEqual({
      name: "Error",
      message: "quebrou",
    });
    expect(serializeError({ motivo: "x" })).toEqual({
      name: "UnknownError",
      message: '{"motivo":"x"}',
    });

    const error = new Error("sem stack");
    delete error.stack;
    expect(serializeError(error)).toEqual({ name: "Error", message: "sem stack" });
  });
});
