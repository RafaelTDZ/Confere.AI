import { JOB_NAMES, type ProcessImportJobData } from "@confere/application";
import { getBoss, stopBoss } from "@confere/infrastructure";
import { processImportJob } from "./jobs/process-import.js";

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? "2");

async function main(): Promise<void> {
  const boss = await getBoss();

  await boss.createQueue(JOB_NAMES.processImport);

  await boss.work<ProcessImportJobData>(
    JOB_NAMES.processImport,
    { batchSize: CONCURRENCY },
    async (jobs) => {
      for (const job of jobs) {
        console.log(
          `[worker] process-import ${job.data.importId} (tenant ${job.data.tenantId})`,
        );
        const result = await processImportJob(job.data);
        console.log(
          `[worker] concluido ${result.importId}: ${result.extractedDocuments} docs, ` +
            `${result.findingsCount} findings, ${result.matchesCount} matches`,
        );
      }
    },
  );

  console.log(
    `[worker] pronto — fila "${JOB_NAMES.processImport}" (concorrencia ${CONCURRENCY})`,
  );

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} recebido, encerrando...`);
    await stopBoss();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[worker] falha fatal:", error);
  process.exit(1);
});
