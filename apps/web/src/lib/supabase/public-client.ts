import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseFetch } from "@/lib/supabase/fetch";
import { getSupabasePublicKey } from "@/lib/supabase/public-key";

/**
 * Client sem cookies/sessão — para RPCs públicas (ex.: email_registered).
 * Evita reenviar JWT antigo (ex.: sessão do Supabase local) que o cloud rejeita
 * com PGRST301 e quebra o login ("Erro ao verificar email").
 */
export function createSupabasePublicClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getSupabasePublicKey();

  if (!url || !key) {
    throw new Error(
      "Variáveis de ambiente Supabase não configuradas. Verifique NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: createSupabaseFetch(key) },
  });
}
