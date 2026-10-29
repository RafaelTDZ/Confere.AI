"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

export default function AppError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Notice tone="danger" title="Não foi possível carregar esta página.">
        <p>
          Algo deu errado do nosso lado. Seus dados não foram alterados. Tente
          de novo; se o problema continuar, volte mais tarde.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => retry()}
          className="mt-3"
        >
          Tentar de novo
        </Button>
      </Notice>
    </div>
  );
}
