import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const backgroundReads = new AsyncLocalStorage<boolean>();

/**
 * Contexto de job em background (worker/`after()`): não há cookie de usuário,
 * então as leituras usam service role. Todos os módulos filtram `tenant_id`
 * explicitamente; o tenant vem do job criado na request autenticada.
 */
export function runWithAdminReads<T>(fn: () => Promise<T>): Promise<T> {
  return backgroundReads.run(true, fn);
}

/**
 * Client de leitura padrão: JWT do usuário (RLS) em requests normais; service
 * role quando dentro de `runWithAdminReads`.
 */
export async function getReadClient(): Promise<SupabaseClient<Database>> {
  if (backgroundReads.getStore()) {
    return createSupabaseAdminClient();
  }
  return createSupabaseServerClient();
}
