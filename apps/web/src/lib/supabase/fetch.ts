/**
 * Publishable/secret keys (`sb_...`) não são JWT.
 * O supabase-js ainda as coloca em `Authorization: Bearer` quando não há
 * sessão; o PostgREST responde PGRST301 ("No suitable key or wrong key type").
 * Mantém a key só em `apikey` e reserva Authorization para JWT de usuário.
 */
export function createSupabaseFetch(supabaseKey: string): typeof fetch {
  const isOpaqueApiKey =
    supabaseKey.startsWith("sb_publishable_") ||
    supabaseKey.startsWith("sb_secret_");

  if (!isOpaqueApiKey) {
    return fetch;
  }

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    // supabase-js às vezes chama fetch(Request) sem init.
    if (input instanceof Request) {
      const headers = new Headers(input.headers);
      const authorization = headers.get("Authorization");
      if (authorization === `Bearer ${supabaseKey}`) {
        headers.delete("Authorization");
        return fetch(new Request(input, { headers }));
      }
      return fetch(input, init);
    }

    const headers = new Headers(init?.headers);
    const authorization = headers.get("Authorization");
    if (authorization === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    return fetch(input, { ...init, headers });
  };
}
