import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AiTaskTimeoutError,
  aiTaskRetries,
  aiTaskTimeoutMs,
  runAiTask,
} from "@/lib/ai/task-timeout";

/** Promessa que só termina quando o sinal é abortado. */
function hangUntilAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

describe("runAiTask", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("devolve o resultado da primeira tentativa", async () => {
    const run = vi.fn().mockResolvedValue("ok");

    await expect(runAiTask("classify", run, { timeoutMs: 1_000 })).resolves.toBe(
      "ok",
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
  });

  it("aborta no timeout e tenta novamente", async () => {
    vi.useFakeTimers();
    const run = vi
      .fn()
      .mockImplementationOnce((signal: AbortSignal) => hangUntilAbort(signal))
      .mockResolvedValueOnce("ok");

    const promise = runAiTask("extract_bl", run, {
      timeoutMs: 1_000,
      retries: 1,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(promise).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("esgota as tentativas com um erro acionável", async () => {
    vi.useFakeTimers();
    const run = vi.fn((signal: AbortSignal) => hangUntilAbort(signal));

    const promise = runAiTask("extract_invoice", run, {
      timeoutMs: 6_000,
      retries: 1,
    });
    promise.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(12_000);

    await expect(promise).rejects.toBeInstanceOf(AiTaskTimeoutError);
    await expect(promise).rejects.toThrow(
      "A IA não respondeu em 6s (extract_invoice, 2 tentativa(s))",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("não repete erros que não são timeout", async () => {
    const run = vi.fn().mockRejectedValue(new Error("schema inválido"));

    await expect(
      runAiTask("extract_bl", run, { timeoutMs: 1_000, retries: 2 }),
    ).rejects.toThrow("schema inválido");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("configuração do orçamento de IA", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lê AI_TASK_TIMEOUT_MS e AI_TASK_RETRIES", () => {
    vi.stubEnv("AI_TASK_TIMEOUT_MS", "30000");
    vi.stubEnv("AI_TASK_RETRIES", "2");

    expect(aiTaskTimeoutMs()).toBe(30_000);
    expect(aiTaskRetries()).toBe(2);
  });

  it("ignora valores fora da faixa", () => {
    vi.stubEnv("AI_TASK_TIMEOUT_MS", "1");
    vi.stubEnv("AI_TASK_RETRIES", "99");

    expect(aiTaskTimeoutMs()).toBe(90_000);
    expect(aiTaskRetries()).toBe(1);
  });
});
