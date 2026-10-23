import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { persistAiLog } from "@/lib/documents/ai-logs";
import { FakeSupabase, type FakeRow } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({ admin: undefined as unknown }));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

let admin: FakeSupabase;

beforeEach(() => {
  admin = new FakeSupabase({ ai_logs: [] });
  mocks.admin = admin;
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
  it("insere todos os campos informados", async () => {
    await persistAiLog({
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

    await expect(persistAiLog(baseParams())).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[ai_logs] falha ao persistir:",
      failure,
    );
    expect(logRows()).toHaveLength(0);
  });
});
