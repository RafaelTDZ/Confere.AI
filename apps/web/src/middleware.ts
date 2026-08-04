import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/supabase/auth-cookie";
import { createSupabaseFetch } from "@/lib/supabase/fetch";
import { getSupabasePublicKey } from "@/lib/supabase/public-key";

function clearAuthCookies(response: NextResponse, request: NextRequest) {
  for (const { name } of request.cookies.getAll()) {
    if (name === AUTH_COOKIE_NAME || name.startsWith(`${AUTH_COOKIE_NAME}.`)) {
      response.cookies.set(name, "", {
        maxAge: 0,
        path: "/",
      });
    }
  }
}

/** Refresh de sessao em toda request (padrao @supabase/ssr). */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = getSupabasePublicKey();

  // Ignorar middleware se variáveis não estiverem configuradas (exemplo: em desenvolvimento local sem .env na raiz)
  if (!supabaseUrl || !supabaseKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    global: { fetch: createSupabaseFetch(supabaseKey) },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options: CookieOptions;
        }>,
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { error } = await supabase.auth.getUser();
  // JWT de outro projeto (ex.: Supabase local) → limpa cookie para não quebrar RPCs/login.
  if (error) {
    clearAuthCookies(response, request);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|supabase|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
