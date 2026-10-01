"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ImportRowActions({
  importId,
  reference,
  canRemove,
}: {
  importId: string;
  reference: string;
  canRemove: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (
      !window.confirm(
        `Remover a importação "${reference}" e todos os documentos enviados? Esta ação não pode ser desfeita.`,
      )
    ) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`/api/imports/${importId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Falha ao remover importação");
      }
      router.refresh();
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "Falha ao remover importação",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="relative z-10 flex justify-end gap-1">
      {canRemove ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Remover importação ${reference}`}
          title="Remover importação"
          disabled={deleting}
          onClick={handleDelete}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      ) : null}
    </div>
  );
}
