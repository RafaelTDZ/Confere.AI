import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTH_COOKIE_NAME } from "@/lib/supabase/auth-cookie";
import type { Database } from "@/lib/supabase/database.types";
import { createSupabaseFetch } from "@/lib/supabase/fetch";
import { getSupabasePublicKey } from "@/lib/supabase/public-key";

/**
 * Client Supabase para Server Components / Route Handlers.
 * Propaga o JWT do usuario — RLS e aplicado pelo Postgres.
 */
export async function createSupabaseServerClient(): Promise<
  SupabaseClient<Database>
> {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getSupabasePublicKey();

  if (!url || !key) {
    throw new Error(
      "Variáveis de ambiente Supabase não configuradas. Verifique NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ou NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }

  return createServerClient<Database>(url, key, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    global: { fetch: createSupabaseFetch(key) },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Chamado de um Server Component: o middleware faz o refresh.
        }
      },
    },
  });
}
