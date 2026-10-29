import { afterEach, describe, expect, it, vi } from "vitest";
import {
  THEME_INIT_SCRIPT,
  nextTheme,
  parseTheme,
  resolveTheme,
} from "@/components/theme/theme-shared";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseTheme", () => {
  it("aceita os três temas válidos", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("system")).toBe("system");
  });

  it("cai em system para ausente ou inválido", () => {
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme(undefined)).toBe("system");
    expect(parseTheme("")).toBe("system");
    expect(parseTheme("Dark")).toBe("system");
    expect(parseTheme("garbage")).toBe("system");
    expect(parseTheme({ theme: "dark" })).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("ignora a preferência do sistema quando o tema é explícito", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("segue a preferência do sistema quando o tema é system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("trata valor inválido como system", () => {
    expect(resolveTheme("garbage", true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme(undefined, true)).toBe("dark");
  });
});

describe("nextTheme", () => {
  it("cicla light → dark → system → light", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
    expect(nextTheme("system")).toBe("light");
  });

  it("trata valor inválido (ex.: storage corrompido) como system", () => {
    expect(nextTheme("garbage")).toBe("light");
    expect(nextTheme(null)).toBe("light");
  });
});

type InitResult = { dark: boolean; colorScheme: string };

function runInitScript({
  stored,
  prefersDark,
}: {
  stored: string | null | Error;
  prefersDark: boolean;
}): InitResult {
  const classes = new Set<string>();
  const root = {
    classList: {
      toggle(name: string, force: boolean) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
    },
    style: { colorScheme: "" },
  };
  vi.stubGlobal("document", { documentElement: root });
  vi.stubGlobal("localStorage", {
    getItem: () => {
      if (stored instanceof Error) throw stored;
      return stored;
    },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: prefersDark }));

  new Function(THEME_INIT_SCRIPT)();

  return { dark: classes.has("dark"), colorScheme: root.style.colorScheme };
}

describe("THEME_INIT_SCRIPT", () => {
  it("aplica dark quando o tema salvo é dark, mesmo com sistema claro", () => {
    expect(runInitScript({ stored: "dark", prefersDark: false })).toEqual({
      dark: true,
      colorScheme: "dark",
    });
  });

  it("mantém light quando o tema salvo é light, mesmo com sistema escuro", () => {
    expect(runInitScript({ stored: "light", prefersDark: true })).toEqual({
      dark: false,
      colorScheme: "light",
    });
  });

  it("segue o sistema sem valor salvo ou com valor inválido", () => {
    expect(runInitScript({ stored: null, prefersDark: true }).dark).toBe(true);
    expect(runInitScript({ stored: null, prefersDark: false }).dark).toBe(false);
    expect(runInitScript({ stored: "garbage", prefersDark: true }).dark).toBe(
      true,
    );
  });

  it("segue o sistema quando o storage está bloqueado", () => {
    expect(
      runInitScript({ stored: new Error("denied"), prefersDark: true }),
    ).toEqual({ dark: true, colorScheme: "dark" });
  });
});
