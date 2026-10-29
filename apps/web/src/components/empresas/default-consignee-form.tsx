"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, CircleCheck, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { TenantPartyOption } from "@/lib/documents/consignee-settings";
import { cn } from "@/lib/utils";

const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function DefaultConsigneeForm({
  options,
  currentId,
  canEdit,
}: {
  options: TenantPartyOption[];
  currentId: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentId ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(partyId: string | null) {
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch("/api/settings/consignee", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partyId }),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(data?.error || "Falha ao salvar consignee padrão");
      }
      setMessage("Consignee padrão atualizado.");
      router.refresh();
    } catch (err) {
      if (partyId === null) setValue(currentId ?? "");
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <p className="text-sm text-muted-foreground">
        Somente owner/admin podem alterar.
      </p>
    );
  }

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma empresa cadastrada ainda. Envie uma análise para cadastrar
        empresas.
      </p>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(value || null);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="default-consignee">Empresa consignee</Label>
        <select
          id="default-consignee"
          className={cn(SELECT_CLASS, saving && "opacity-60")}
          value={value}
          disabled={saving}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="">Nenhum</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
              {option.cnpj ? ` — ${option.cnpj}` : ""}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
      {message && (
        <p className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-primary" />
          {message}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {currentId && (
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              setValue("");
              void save(null);
            }}
          >
            Remover padrão
          </Button>
        )}
        <Button type="submit" disabled={saving}>
          {saving ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar"
          )}
        </Button>
      </div>
    </form>
  );
}
