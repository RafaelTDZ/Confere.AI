import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Client de leitura com o JWT do usuário (RLS aplicado).
 * Use somente em Server Components/Route Handlers; escritas administrativas
 * continuam via service role.
 */
export async function getReadClient(): Promise<SupabaseClient<Database>> {
  return createSupabaseServerClient();
}
