/** Nome fixo do cookie de sessão Auth.
 * Sem isso, browser (origin/supabase) e server (127.0.0.1:54321)
 * geram storageKeys diferentes e o layout manda de volta ao login.
 */
export const AUTH_COOKIE_NAME = "sb-confere-auth-token";
