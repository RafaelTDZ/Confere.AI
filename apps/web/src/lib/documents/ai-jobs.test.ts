import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimAiJob,
  claimNextAiJob,
  createAiJob,
  downloadAiJobFile,
  getAiJobForTenant,
  markAiJobFailed,
  markAiJobSucceeded,
  removeAiJobFile,
} from "@/lib/documents/ai-jobs";
import { FakeSupabase, type FakeRow } from "@/test/fake-supabase";

const mocks = vi.hoisted(() => ({
  admin: undefined as unknown,
  read: undefined as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mocks.admin,
}));

vi.mock("@/lib/supabase/read-client", () => ({
  getReadClient: async () => mocks.read,
}));

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const JOB_ID = "8a1e2c3d-4b5f-4a6b-8c7d-9e0f1a2b3c4d";

function jobSeed(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: JOB_ID,
    tenant_id: TENANT_A,
    import_id: null,
    user_id: "user-a",
    status: "queued",
    storage_path: `${TENANT_A}/_jobs/${JOB_ID}/invoice.pdf`,
    file_name: "invoice.pdf",
    media_type: "application/pdf",
    size_bytes: 4,
    sha256: "digest-a",
    attempts: 0,
    error_message: null,
    result: null,
    created_at: "2026-10-26T12:00:00.000Z",
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

let db: FakeSupabase;

beforeEach(() => {
  db = new FakeSupabase({ ai_jobs: [] });
  mocks.admin = db;
  mocks.read = db;
});

function fileParams() {
  return {
    bytes: new Uint8Array([1, 2, 3, 4]),
    filename: "Invoice 001.pdf",
    mediaType: "application/pdf",
    digest: "sha-abc",
  };
}

describe("createAiJob", () => {
  it("grava o arquivo no Storage e cria o job na fila", async () => {
    const job = await createAiJob({
      tenantId: TENANT_A,
      userId: "user-a",
      file: fileParams(),
    });

    expect(job).toMatchObject({
      tenant_id: TENANT_A,
      user_id: "user-a",
      import_id: null,
      status: "queued",
      file_name: "Invoice 001.pdf",
      media_type: "application/pdf",
      size_bytes: 4,
      sha256: "sha-abc",
    });
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.storage.uploads).toHaveLength(1);
    expect(db.storage.uploads[0]).toMatchObject({
      bucket: "import-documents",
      options: { contentType: "application/pdf", upsert: false },
    });
    expect(db.storage.uploads[0]?.path).toBe(
      `${TENANT_A}/_jobs/${job.id}/Invoice 001.pdf`,
    );
    expect(db.rows("ai_jobs")).toHaveLength(1);
  });

  it("vincula o importId informado", async () => {
    const job = await createAiJob({
      tenantId: TENANT_A,
      userId: "user-a",
      importId: "import-1",
      file: fileParams(),
    });

    expect(job.import_id).toBe("import-1");
  });

  it("propaga erro do upload sem criar job", async () => {
    db.storage.uploadError = { message: "storage offline" };

    await expect(
      createAiJob({
        tenantId: TENANT_A,
        userId: "user-a",
        file: fileParams(),
      }),
    ).rejects.toThrow("storage offline");

    expect(db.rows("ai_jobs")).toHaveLength(0);
  });

  it("propaga erro do insert", async () => {
    db.failNext(
      { message: "insert falhou" },
      { table: "ai_jobs", operation: "insert" },
    );

    await expect(
      createAiJob({
        tenantId: TENANT_A,
        userId: "user-a",
        file: fileParams(),
      }),
    ).rejects.toThrow("insert falhou");
  });
});

describe("getAiJobForTenant", () => {
  it("devolve o job do próprio tenant", async () => {
    db.rows("ai_jobs").push(jobSeed());

    const job = await getAiJobForTenant(TENANT_A, JOB_ID);

    expect(job).toMatchObject({ id: JOB_ID, tenant_id: TENANT_A });
  });

  it("devolve null para job de outro tenant", async () => {
    db.rows("ai_jobs").push(jobSeed());

    await expect(getAiJobForTenant(TENANT_B, JOB_ID)).resolves.toBeNull();
  });

  it("propaga erro de select", async () => {
    db.failNext(
      { message: "falha ao consultar" },
      { table: "ai_jobs", operation: "select" },
    );

    await expect(getAiJobForTenant(TENANT_A, JOB_ID)).rejects.toThrow(
      "falha ao consultar",
    );
  });
});

describe("claimAiJob", () => {
  it("chama a RPC com o id do job", async () => {
    db.onRpc("claim_ai_job", { data: jobSeed({ status: "running" }) });

    const job = await claimAiJob(JOB_ID);

    expect(job).toMatchObject({ id: JOB_ID, status: "running" });
    expect(db.rpcCalls).toEqual([
      { name: "claim_ai_job", params: { p_job_id: JOB_ID } },
    ]);
  });

  it("devolve null quando outro worker já reservou", async () => {
    db.onRpc("claim_ai_job", { data: null });

    await expect(claimAiJob(JOB_ID)).resolves.toBeNull();
  });

  it("propaga erro da RPC", async () => {
    db.onRpc("claim_ai_job", { error: { message: "rpc falhou" } });

    await expect(claimAiJob(JOB_ID)).rejects.toThrow("rpc falhou");
  });
});

describe("claimNextAiJob", () => {
  it("usa os padrões de stale/max attempts", async () => {
    db.onRpc("claim_next_ai_job", { data: jobSeed({ status: "running" }) });

    await claimNextAiJob();

    expect(db.rpcCalls).toEqual([
      {
        name: "claim_next_ai_job",
        params: { p_stale_seconds: 900, p_max_attempts: 3 },
      },
    ]);
  });

  it("repassa opções customizadas", async () => {
    db.onRpc("claim_next_ai_job", { data: null });

    await claimNextAiJob({ staleSeconds: 60, maxAttempts: 5 });

    expect(db.rpcCalls[0]?.params).toEqual({
      p_stale_seconds: 60,
      p_max_attempts: 5,
    });
  });
});

describe("markAiJobSucceeded", () => {
  it("grava status, resultado, import e conclusão", async () => {
    db.rows("ai_jobs").push(jobSeed({ status: "running" }));

    await markAiJobSucceeded(JOB_ID, {
      importId: "import-1",
      types: ["invoice"],
      deduped: false,
    });

    expect(db.rows("ai_jobs")[0]).toMatchObject({
      status: "succeeded",
      import_id: "import-1",
      result: { importId: "import-1", types: ["invoice"], deduped: false },
      error_message: null,
    });
    expect(db.rows("ai_jobs")[0]?.finished_at).toEqual(expect.any(String));
  });

  it("propaga erro do update", async () => {
    db.failNext(
      { message: "falha ao concluir" },
      { table: "ai_jobs", operation: "update" },
    );

    await expect(
      markAiJobSucceeded(JOB_ID, {
        importId: "import-1",
        types: [],
        deduped: true,
      }),
    ).rejects.toThrow("falha ao concluir");
  });
});

describe("markAiJobFailed", () => {
  it("grava status failed e limita a mensagem", async () => {
    db.rows("ai_jobs").push(jobSeed({ status: "running" }));

    await markAiJobFailed(JOB_ID, "x".repeat(700));

    const row = db.rows("ai_jobs")[0];
    expect(row).toMatchObject({ status: "failed" });
    expect((row?.error_message as string).length).toBe(500);
    expect(row?.finished_at).toEqual(expect.any(String));
  });
});

describe("downloadAiJobFile", () => {
  it("monta o File a partir do Storage", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    db.storage.files.set(`${TENANT_A}/_jobs/${JOB_ID}/invoice.pdf`, {
      bytes,
      mediaType: "application/pdf",
    });

    const file = await downloadAiJobFile(jobSeed() as never);

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("invoice.pdf");
    expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it("propaga erro quando o arquivo não existe", async () => {
    await expect(downloadAiJobFile(jobSeed() as never)).rejects.toThrow(
      "não encontrado",
    );
  });
});

describe("removeAiJobFile", () => {
  it("remove o arquivo do bucket", async () => {
    await removeAiJobFile(`${TENANT_A}/_jobs/${JOB_ID}/invoice.pdf`);

    expect(db.storage.removals).toEqual([
      {
        bucket: "import-documents",
        paths: [`${TENANT_A}/_jobs/${JOB_ID}/invoice.pdf`],
      },
    ]);
  });

  it("registra falha do Storage sem lançar", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.storage.removeError = { message: "storage offline" };

    await expect(
      removeAiJobFile(`${TENANT_A}/_jobs/${JOB_ID}/invoice.pdf`),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[ai-jobs] falha ao remover arquivo do job",
      { message: "storage offline" },
    );
  });
});
