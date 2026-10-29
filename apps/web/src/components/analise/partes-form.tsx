"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  partyRolesLabel,
  type PendingParty,
} from "@/lib/documents/parties-shared";

type PartyDraft = PartyFieldsValue & {
  roles: PendingParty["roles"];
};

function toDraft(party: PendingParty): PartyDraft {
  return {
    roles: party.roles,
    ...toPartyFieldsValue({
      name: party.name ?? "",
      cnpj: party.cnpj ?? "",
      address: party.address,
    }),
  };
}

export function PartesForm({
  importId,
  pendingParties,
}: {
  importId: string;
  pendingParties: PendingParty[];
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<PartyDraft[]>(() =>
    pendingParties.map(toDraft),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateDraft(index: number, next: PartyFieldsValue) {
    setDrafts((current) =>
      current.map((item, i) => (i === index ? { ...item, ...next } : item)),
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/imports/${importId}/parties`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parties: drafts.map((draft) => ({
            roles: draft.roles,
            name: draft.name,
            cnpj: draft.cnpj,
            address: draft.address,
          })),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Falha ao cadastrar partes");
      }
      router.push(`/importacoes/${importId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {drafts.map((draft, index) => (
        <Card key={draft.roles.join("-")}>
          <CardHeader>
            <CardTitle className="text-base">
              {partyRolesLabel(draft.roles)}
            </CardTitle>
            <CardDescription>
              Confira os dados extraídos dos documentos antes de salvar
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PartyFields
              idPrefix={`party-${index}`}
              value={draft}
              disabled={loading}
              onChange={(next) => updateDraft(index, next)}
            />
          </CardContent>
        </Card>
      ))}

      {error && (
        <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={loading}>
          {loading ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : (
            "Salvar cadastro"
          )}
        </Button>
      </div>
    </form>
  );
}
