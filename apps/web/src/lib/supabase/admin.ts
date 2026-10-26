import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Client Supabase com service role / secret key (bypassa RLS).
 * Usado apenas no servidor para escrever extraction_results e ai_logs.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SECRET_KEY) não configurada. Necessária para persistir extrações de IA.",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
