import PgBoss from "pg-boss";
import type {
  EnqueueOptions,
  QueuePublisher,
} from "@confere/application";

let boss: PgBoss | null = null;

export async function getBoss(
  connectionString = process.env.DATABASE_URL,
): Promise<PgBoss> {
  if (boss) return boss;
  if (!connectionString) throw new Error("DATABASE_URL nao configurada");

  boss = new PgBoss({
    connectionString,
    schema: process.env.QUEUE_SCHEMA ?? "pgboss",
    supervise: true,
  });
  await boss.start();
  return boss;
}

export async function stopBoss(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true, timeout: 30_000 });
    boss = null;
  }
}

export class PgBossPublisher implements QueuePublisher {
  constructor(private readonly client: PgBoss) {}

  async enqueue<T>(
    jobName: string,
    data: T,
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    return this.client.send(jobName, data as object, {
      singletonKey: options.singletonKey,
      startAfter: options.startAfterSeconds,
      retryLimit: options.retryLimit ?? 3,
      retryBackoff: true,
      priority: options.priority ?? 0,
    });
  }
}
