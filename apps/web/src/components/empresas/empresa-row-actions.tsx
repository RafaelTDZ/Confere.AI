"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmpresaRowActions({
  partyId,
  partyName,
}: {
  partyId: string;
  partyName: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!window.confirm(`Deseja excluir a empresa "${partyName}"?`)) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/parties/${partyId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Falha ao excluir empresa");
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Falha ao excluir empresa");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="relative z-10 flex justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={`Excluir ${partyName}`}
        title="Excluir"
        disabled={deleting}
        onClick={handleDelete}
        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        {deleting ? (
          <LoaderCircle className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
