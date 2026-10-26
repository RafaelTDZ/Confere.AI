import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  processAiJobById,
  processNextAiJob,
} from "@/lib/documents/ai-worker";

const mocks = vi.hoisted(() => ({
  claimAiJob: vi.fn(),
  claimNextAiJob: vi.fn(),
  downloadAiJobFile: vi.fn(),
  markAiJobFailed: vi.fn(),
  markAiJobSucceeded: vi.fn(),
  removeAiJobFile: vi.fn(),
  runAnalyzePipeline: vi.fn(),
}));

vi.mock("@/lib/documents/ai-jobs", () => ({
  claimAiJob: mocks.claimAiJob,
  claimNextAiJob: mocks.claimNextAiJob,
  downloadAiJobFile: mocks.downloadAiJobFile,
  markAiJobFailed: mocks.markAiJobFailed,
  markAiJobSucceeded: mocks.markAiJobSucceeded,
  removeAiJobFile: mocks.removeAiJobFile,
}));

vi.mock("@/lib/documents/analyze-pipeline", () => ({
  runAnalyzePipeline: mocks.runAnalyzePipeline,
}));

const JOB = {
  id: "job-1",
  tenant_id: "tenant-a",
  import_id: null,
  user_id: "user-a",
  status: "running",
  storage_path: "tenant-a/_jobs/job-1/invoice.pdf",
  file_name: "invoice.pdf",
  media_type: "application/pdf",
  size_bytes: 4,
  sha256: "digest",
  attempts: 1,
  error_message: null,
  result: null,
  created_at: "2026-10-26T12:00:00.000Z",
  started_at: "2026-10-26T12:00:01.000Z",
  finished_at: null,
};

const PIPELINE_RESULT = {
  importId: "import-1",
  types: ["invoice"],
  documents: [{ id: "doc-1", docType: "invoice" }],
  invoice: null,
  extractionResultId: "extraction-1",
  pendingParties: [],
  model: "model-x",
  latencyMs: 10,
  deduped: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.downloadAiJobFile.mockResolvedValue(new File([], "invoice.pdf"));
  mocks.runAnalyzePipeline.mockResolvedValue(PIPELINE_RESULT);
  mocks.markAiJobSucceeded.mockResolvedValue(undefined);
  mocks.markAiJobFailed.mockResolvedValue(undefined);
  mocks.removeAiJobFile.mockResolvedValue(undefined);
});

describe("processAiJobById", () => {
  it("não faz nada quando outro worker já reservou o job", async () => {
    mocks.claimAiJob.mockResolvedValue(null);

    await processAiJobById("job-1");

    expect(mocks.downloadAiJobFile).not.toHaveBeenCalled();
    expect(mocks.runAnalyzePipeline).not.toHaveBeenCalled();
  });

  it("roda o pipeline e conclui o job", async () => {
    mocks.claimAiJob.mockResolvedValue(JOB);

    await processAiJobById("job-1");

    expect(mocks.runAnalyzePipeline).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      userId: "user-a",
      file: expect.any(File),
      importId: undefined,
    });
    expect(mocks.markAiJobSucceeded).toHaveBeenCalledWith("job-1", {
      importId: "import-1",
      types: ["invoice"],
      deduped: false,
    });
    expect(mocks.removeAiJobFile).toHaveBeenCalledWith(JOB.storage_path);
  });

  it("repassa o importId do job para o pipeline", async () => {
    mocks.claimAiJob.mockResolvedValue({ ...JOB, import_id: "import-9" });

    await processAiJobById("job-1");

    expect(mocks.runAnalyzePipeline).toHaveBeenCalledWith(
      expect.objectContaining({ importId: "import-9" }),
    );
  });

  it("marca o job como failed quando o pipeline lança", async () => {
    mocks.claimAiJob.mockResolvedValue(JOB);
    mocks.runAnalyzePipeline.mockRejectedValue(new Error("IA fora do ar"));

    await processAiJobById("job-1");

    expect(mocks.markAiJobFailed).toHaveBeenCalledWith("job-1", "IA fora do ar");
    expect(mocks.markAiJobSucceeded).not.toHaveBeenCalled();
    expect(mocks.removeAiJobFile).not.toHaveBeenCalled();
  });

  it("marca failed quando o download do arquivo falha", async () => {
    mocks.claimAiJob.mockResolvedValue(JOB);
    mocks.downloadAiJobFile.mockRejectedValue(new Error("storage offline"));

    await processAiJobById("job-1");

    expect(mocks.markAiJobFailed).toHaveBeenCalledWith(
      "job-1",
      "storage offline",
    );
    expect(mocks.runAnalyzePipeline).not.toHaveBeenCalled();
  });

  it("não propaga erro ao falhar o registro do failed", async () => {
    mocks.claimAiJob.mockResolvedValue(JOB);
    mocks.runAnalyzePipeline.mockRejectedValue(new Error("boom"));
    mocks.markAiJobFailed.mockRejectedValue(new Error("update falhou"));

    await expect(processAiJobById("job-1")).resolves.toBeUndefined();
  });

  it("não marca failed quando a análise concluiu mas o job falha ao fechar", async () => {
    mocks.claimAiJob.mockResolvedValue(JOB);
    mocks.markAiJobSucceeded.mockRejectedValue(new Error("update falhou"));

    await expect(processAiJobById("job-1")).resolves.toBeUndefined();

    expect(mocks.markAiJobFailed).not.toHaveBeenCalled();
    expect(mocks.removeAiJobFile).not.toHaveBeenCalled();
  });
});

describe("processNextAiJob", () => {
  it("devolve false quando a fila está vazia", async () => {
    mocks.claimNextAiJob.mockResolvedValue(null);

    await expect(processNextAiJob()).resolves.toBe(false);
    expect(mocks.runAnalyzePipeline).not.toHaveBeenCalled();
  });

  it("processa o próximo job e devolve true", async () => {
    mocks.claimNextAiJob.mockResolvedValue(JOB);

    await expect(processNextAiJob({ staleSeconds: 60 })).resolves.toBe(true);

    expect(mocks.claimNextAiJob).toHaveBeenCalledWith({ staleSeconds: 60 });
    expect(mocks.runAnalyzePipeline).toHaveBeenCalledTimes(1);
  });
});
