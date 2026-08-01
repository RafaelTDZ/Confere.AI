/**
 * Chave pública do Supabase (browser / SSR com RLS).
 * Prefere a publishable key nova (`sb_publishable_...`); fallback para anon JWT legada.
 */
export function getSupabasePublicKey(): string | undefined {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  
  if (!key) {
    console.log("[v0] Variáveis Supabase:", {
      url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      publishable: !!process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      anon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    });
  }
  
  return key || undefined;
}
