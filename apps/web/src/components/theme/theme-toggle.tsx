"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme/theme-provider";
import {
  THEME_LABELS,
  nextTheme,
  type Theme,
} from "@/components/theme/theme-shared";

const THEME_ICONS: Record<Theme, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = nextTheme(theme);
  const Icon = THEME_ICONS[theme];
  const label = `Tema atual: ${THEME_LABELS[theme]}. Trocar para ${THEME_LABELS[next]}`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </Button>
  );
}
