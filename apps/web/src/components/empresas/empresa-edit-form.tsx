"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  PartyFields,
  toPartyFieldsValue,
  type PartyFieldsValue,
} from "@/components/parties/party-fields";
import type { PartyAddress } from "@/lib/documents/parties-shared";
import { setFlash } from "@/lib/flash";
import { cn } from "@/lib/utils";

export function EmpresaEditForm({
  partyId,
  name,
  cnpj,
  address,
  canEdit,
}: {
  partyId: string;
  name: string;
  cnpj: string;
  address: PartyAddress;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<PartyFieldsValue>(() =>
    toPartyFieldsValue({ name, cnpj, address }),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/parties/${partyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: value.name,
          cnpj: value.cnpj,
          address: value.address,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Falha ao atualizar empresa");
      }
      setFlash("Empresa atualizada com sucesso.");
      router.push("/empresas");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da empresa</CardTitle>
          <CardDescription>
            {canEdit
              ? "Atualize nome, CNPJ e endereço cadastrados neste tenant."
              : "Seu perfil só permite visualizar os dados desta empresa."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <PartyFields
            idPrefix="empresa"
            value={value}
            disabled={loading || !canEdit}
            onChange={setValue}
          />
        </CardContent>
      </Card>

      {error && (
        <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Link
          href="/empresas"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Voltar
        </Link>
        {canEdit ? (
          <Button type="submit" disabled={loading}>
            {loading ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
