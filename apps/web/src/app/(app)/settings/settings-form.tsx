"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SettingsForm({
  confidenceThreshold,
  disabled,
}: {
  confidenceThreshold: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(
    String(Math.round(confidenceThreshold * 100)),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);

    try {
      const value = Number(threshold) / 100;
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confidenceThreshold: value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Falha ao salvar");
      }
      setMessage("Configuracoes salvas");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="threshold">Limiar de confianca (%)</Label>
        <Input
          id="threshold"
          type="number"
          min={0}
          max={100}
          value={threshold}
          disabled={disabled}
          onChange={(e) => setThreshold(e.target.value)}
        />
      </div>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      {!disabled && (
        <Button type="submit" disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </Button>
      )}
    </form>
  );
}
