"use client";

import { useEffect, useRef, useState } from "react";
import { Notice } from "@/components/ui/notice";
import { takeFlash } from "@/lib/flash";

/**
 * Mostra (uma vez) a mensagem deixada por `setFlash` antes de navegar para a
 * listagem. Não usa query string: voltar de um detalhe não reexibe o aviso.
 */
export function FlashNotice() {
  const [message, setMessage] = useState<string | null>(null);
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    setMessage(takeFlash());
  }, []);

  if (!message) return null;

  return <Notice tone="success">{message}</Notice>;
}
