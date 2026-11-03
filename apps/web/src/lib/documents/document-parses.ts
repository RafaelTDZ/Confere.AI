import "server-only";

import { createLogger } from "@/lib/observability/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const log = createLogger("document-parses");

/**
 * Cache e orçamento do parse de PDF (Firecrawl `/v2/parse`).
 *
 * Sempre via service role: o worker de análise roda em `after()`/cron, sem
 * cookie de sessão. Nenhuma falha aqui pode derrubar o parse — o pior caso é
 * gastar um crédito que não foi contabilizado (logado) ou não aproveitar cache.
 */

/** Período contábil do orçamento: YYYY-MM em UTC. */
function documentParsePeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * `database.types.ts` é gerado do cloud depois de aplicar a migration; até a
 * regeneração, as tabelas novas não existem no tipo `Database`. Estes tipos
 * descrevem só a fatia usada aqui (e são trocados pela tipagem gerada).
 */
type QueryError = { message: string };

type DocumentParseRow = {
  markdown: string;
  pages: number;
  credits: number;
};

type UsageRow = { credits_used: number };

type SingleRow<Row> = {
  eq(column: string, value: string): SingleRow<Row>;
  maybeSingle(): PromiseLike<{
    data: Row | null;
    error: QueryError | null;
  }>;
};

type DocumentParsesTable = {
  select(columns: string): SingleRow<DocumentParseRow>;
  upsert(
    values: {
      tenant_id: string;
      sha256: string;
      provider: string;
      markdown: string;
      pages: number;
      credits: number;
    },
    options: { onConflict: string; ignoreDuplicates: boolean },
  ): PromiseLike<{ error: QueryError | null }>;
};

type DocumentParseUsageTable = {
  select(columns: string): SingleRow<UsageRow>;
};

type DocumentParseClient = {
  from(table: "document_parses"): DocumentParsesTable;
  from(table: "document_parse_usage"): DocumentParseUsageTable;
  rpc(
    fn: "consume_document_parse_credits",
    args: {
      p_tenant_id: string;
      p_period: string;
      p_credits: number;
      p_limit: number;
    },
  ): PromiseLike<{ data: boolean | null; error: QueryError | null }>;
};

function documentParseClient(): DocumentParseClient {
  return createSupabaseAdminClient() as unknown as DocumentParseClient;
}

/** Markdown em cache para o mesmo arquivo (tenant + sha256), se existir. */
export async function getCachedDocumentParse(
  tenantId: string,
  sha256: string,
): Promise<{ markdown: string; pages: number; credits: number } | null> {
  try {
    const admin = documentParseClient();
    const { data, error } = await admin
      .from("document_parses")
      .select("markdown, pages, credits")
      .eq("tenant_id", tenantId)
      .eq("sha256", sha256)
      .maybeSingle();

    if (error) {
      log.error("cache_read_failed", {
        tenantId,
        sha256: sha256.slice(0, 12),
        error: error.message,
      });
      return null;
    }
    if (!data) return null;

    return {
      markdown: data.markdown,
      pages: data.pages,
      credits: data.credits,
    };
  } catch (error) {
    log.error("cache_read_failed", {
      tenantId,
      sha256: sha256.slice(0, 12),
      error,
      unexpected: true,
    });
    return null;
  }
}

/**
 * Grava o markdown no cache. Duplicado (mesmo tenant + sha256) é ignorado:
 * duas análises simultâneas do mesmo arquivo não podem falhar por corrida.
 */
export async function saveDocumentParse(params: {
  tenantId: string;
  sha256: string;
  markdown: string;
  pages: number;
  credits: number;
}): Promise<void> {
  try {
    const admin = documentParseClient();
    const { error } = await admin.from("document_parses").upsert(
      {
        tenant_id: params.tenantId,
        sha256: params.sha256,
        provider: "firecrawl",
        markdown: params.markdown,
        pages: params.pages,
        credits: params.credits,
      },
      { onConflict: "tenant_id,sha256", ignoreDuplicates: true },
    );

    if (error) {
      log.warn("cache_write_failed", {
        tenantId: params.tenantId,
        sha256: params.sha256.slice(0, 12),
        pages: params.pages,
        credits: params.credits,
        error: error.message,
      });
    }
  } catch (error) {
    log.warn("cache_write_failed", {
      tenantId: params.tenantId,
      sha256: params.sha256.slice(0, 12),
      error,
      unexpected: true,
    });
  }
}

/** Créditos/páginas consumidos pelo tenant no mês corrente. */
export async function getDocumentParseCreditsUsed(
  tenantId: string,
): Promise<number> {
  try {
    const admin = documentParseClient();
    const { data, error } = await admin
      .from("document_parse_usage")
      .select("credits_used")
      .eq("tenant_id", tenantId)
      .eq("period", documentParsePeriod())
      .maybeSingle();

    if (error) {
      log.error("usage_read_failed", {
        tenantId,
        period: documentParsePeriod(),
        error: error.message,
      });
      return 0;
    }
    return data?.credits_used ?? 0;
  } catch (error) {
    log.error("usage_read_failed", {
      tenantId,
      period: documentParsePeriod(),
      error,
      unexpected: true,
    });
    return 0;
  }
}

/**
 * Registra o consumo de forma atômica (RPC com `for update`). Retorna false
 * quando `limit > 0` e o teto seria ultrapassado — nada é gravado nesse caso.
 * Falha de infraestrutura devolve true: o parse já aconteceu e não vale
 * bloquear a análise por um contador indisponível (o erro fica no log).
 */
export async function consumeDocumentParseCredits(params: {
  tenantId: string;
  credits: number;
  limit: number;
}): Promise<boolean> {
  try {
    const admin = documentParseClient();
    const { data, error } = await admin.rpc("consume_document_parse_credits", {
      p_tenant_id: params.tenantId,
      p_period: documentParsePeriod(),
      p_credits: params.credits,
      p_limit: params.limit,
    });

    if (error) {
      log.error("credits_consume_failed", {
        tenantId: params.tenantId,
        period: documentParsePeriod(),
        credits: params.credits,
        limit: params.limit,
        error: error.message,
      });
      return true;
    }
    return data === true;
  } catch (error) {
    log.error("credits_consume_failed", {
      tenantId: params.tenantId,
      period: documentParsePeriod(),
      credits: params.credits,
      limit: params.limit,
      error,
      unexpected: true,
    });
    return true;
  }
}
