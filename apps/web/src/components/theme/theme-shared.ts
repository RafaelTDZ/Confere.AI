export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "confere-theme";

export const THEME_LABELS: Record<Theme, string> = {
  light: "Claro",
  dark: "Escuro",
  system: "Sistema",
};

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

/** Valor vindo do localStorage (ou de fora) vira um tema válido; o resto é `system`. */
export function parseTheme(value: unknown): Theme {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : "system";
}

/** `system` segue a preferência do SO; valor inválido também cai nela. */
export function resolveTheme(
  theme: unknown,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (theme === "light" || theme === "dark") return theme;
  return systemPrefersDark ? "dark" : "light";
}

/** Ordem do botão: claro → escuro → sistema → claro. */
export function nextTheme(theme: unknown): Theme {
  return NEXT_THEME[parseTheme(theme)];
}

/**
 * Script inline do `<head>` (ver `app/layout.tsx`): aplica a classe `dark` antes
 * do primeiro paint. Mesma regra de `parseTheme`/`resolveTheme`, sem eval.
 */
export const THEME_INIT_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"})();`;
