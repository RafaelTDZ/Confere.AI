import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Client de leitura com o JWT do usuário (RLS aplicado).
 * Use somente em Server Components/Route Handlers; escritas administrativas
 * continuam via service role.
 */
export async function getReadClient(): Promise<SupabaseClient> {
  return createSupabaseServerClient();
}
