"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewImportForm() {
  const router = useRouter();
  const [referenceNumber, setReferenceNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [incoterm, setIncoterm] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceNumber: referenceNumber.trim(),
          supplierName: supplierName.trim() || undefined,
          incoterm: incoterm.trim() || undefined,
          currency: currency.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Falha ao criar importacao");
      }

      const body = await response.json();
      router.push(`/imports/${body.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="reference">Numero de referencia *</Label>
        <Input
          id="reference"
          required
          value={referenceNumber}
          onChange={(e) => setReferenceNumber(e.target.value)}
          placeholder="IMP-2026-001"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="supplier">Fornecedor</Label>
        <Input
          id="supplier"
          value={supplierName}
          onChange={(e) => setSupplierName(e.target.value)}
          placeholder="Shenzhen Export Co."
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="incoterm">INCOTERM</Label>
          <Input
            id="incoterm"
            value={incoterm}
            onChange={(e) => setIncoterm(e.target.value)}
            placeholder="FOB"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="currency">Moeda</Label>
          <Input
            id="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            placeholder="USD"
            maxLength={3}
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Criando..." : "Criar e enviar documentos"}
      </Button>
    </form>
  );
}
