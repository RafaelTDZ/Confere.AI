import { expect } from "vitest";

/**
 * Helpers para os testes que espionam `console.*`.
 *
 * O logger escreve **uma linha JSON por evento**, então a asserção não é sobre
 * a string da mensagem, e sim sobre o evento e os campos estruturados. Isso
 * mantém o teste legível e deixa de quebrar quando o texto humano muda.
 *
 * Aceita tanto a spy (`vi.spyOn(console, "warn")`) quanto o próprio
 * `console.warn` (que, com a spy instalada, é o mock) — daí o `unknown`.
 */

export type LogRecord = Record<string, unknown> & {
  level?: string;
  scope?: string;
  event?: string;
};

type ConsoleSpyLike = {
  mock?: { calls?: unknown[][] };
};

function callsOf(spy: unknown): unknown[][] {
  const calls = (spy as ConsoleSpyLike | null)?.mock?.calls;
  if (!Array.isArray(calls)) {
    throw new Error(
      "esperava um console espionado (vi.spyOn(console, ...)) ou um método do console",
    );
  }
  return calls;
}

function logRecords(spy: unknown): LogRecord[] {
  return callsOf(spy).map(([line]) => {
    if (typeof line !== "string") {
      throw new Error(`log não é uma linha JSON: ${String(line)}`);
    }
    return JSON.parse(line) as LogRecord;
  });
}

/** Todos os eventos emitidos, na ordem — `["job_started", "job_failed"]`. */
export function loggedEvents(spy: unknown): string[] {
  return logRecords(spy).map((record) => String(record.event));
}

/**
 * Garante que houve um log com `event` (e opcionalmente com os campos dados).
 * Quando o evento não aparece, a mensagem lista os eventos emitidos.
 */
export function expectLog(
  spy: unknown,
  event: string,
  fields: Record<string, unknown> = {},
): LogRecord {
  const records = logRecords(spy);
  const record = records.find((entry) => entry.event === event);
  if (!record) {
    throw new Error(
      `nenhum log com event="${event}". Emitidos: ${
        records.map((entry) => entry.event).join(", ") || "(nenhum)"
      }`,
    );
  }
  expect(record).toMatchObject(fields);
  return record;
}
