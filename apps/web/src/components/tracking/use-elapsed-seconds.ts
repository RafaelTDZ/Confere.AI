"use client";

import { useEffect, useState } from "react";

/**
 * Segundos desde `startedAt`. O relógio só avança dentro do timer (nada de
 * `Date.now()` no render, que quebra a pureza exigida pelo React Compiler).
 */
export function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (startedAt === null || now <= startedAt) return 0;
  return Math.floor((now - startedAt) / 1_000);
}

/** Timestamp (ms) de uma data ISO, ou null quando ausente/inválida. */
export function toTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
