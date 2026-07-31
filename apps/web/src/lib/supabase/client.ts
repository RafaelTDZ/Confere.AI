"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * URL pública do Supabase no browser.
 * Usa proxy same-origin (/supabase → 127.0.0.1:54321) para funcionar
 * em preview/túnel remoto, não só em localhost.
 */
function getBrowserSupabaseUrl(): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/supabase`;
  }
  return process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
}

export function getSupabaseBrowserClient(): SupabaseClient {
  if (client) return client;

  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!key) {
    throw new Error(
      "Variáveis de ambiente Supabase não configuradas. Verifique NEXT_PUBLIC_SUPABASE_ANON_KEY em seu arquivo .env.local",
    );
  }

  client = createBrowserClient(getBrowserSupabaseUrl(), key);
  return client;
}
