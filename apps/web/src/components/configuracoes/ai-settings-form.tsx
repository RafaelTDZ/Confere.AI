"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { isModelCompatibleWithProvider } from "@/lib/ai/model-compat";
import type { AiProviderId } from "@/lib/ai/provider";
import type { ProviderInfo } from "@/lib/ai/catalog";

type AiSettingsPayload = {
  overrides: { provider?: AiProviderId; model?: string };
  config: { provider: AiProviderId; model: string; source: "global" | "env" };
  keys: { fireworksConfigured: boolean; openrouterConfigured: boolean };
  catalog: ProviderInfo[];
};

export function AiSettingsForm() {
  const [data, setData] = useState<AiSettingsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState<AiProviderId>("fireworks");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/ai", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as AiSettingsPayload & {
        error?: string;
      };
      if (!res.ok || !json) {
        throw new Error(json?.error ?? "Falha ao carregar configurações");
      }
      setData(json);
      setProvider(json.config.provider);
      setModel(json.config.model);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Falha ao carregar configurações",
      );
    }
  }, []);

  useEffect(() => {
    // Busca inicial na API: o setState ocorre depois do await, não de forma síncrona.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model: model.trim() || undefined }),
      });
      const json = (await res.json().catch(() => null)) as AiSettingsPayload & {
        error?: string;
      };
      if (!res.ok || !json) {
        throw new Error(json?.error ?? "Falha ao salvar");
      }
      setData(json);
      setProvider(json.config.provider);
      setModel(json.config.model);
      setMessage({ kind: "ok", text: "Configuração salva para todos os usuários." });
    } catch (error) {
      setMessage({
        kind: "err",
        text: error instanceof Error ? error.message : "Falha ao salvar",
      });
    } finally {
      setSaving(false);
    }
  }

  function handleProviderChange(next: AiProviderId) {
    if (!data) return;
    setProvider(next);
    const nextPresets = data.catalog.find((item) => item.id === next)?.models ?? [];
    const current = model.trim();
    const aindaValido = isModelCompatibleWithProvider(
      next,
      current,
      nextPresets.map((preset) => preset.id),
    );
    if (!aindaValido) setModel(nextPresets[0]?.id ?? "");
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Não foi possível carregar</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setLoadError(null);
              void load();
            }}
          >
            Tentar de novo
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Carregando configurações de IA…
        </CardContent>
      </Card>
    );
  }

  const providerInfo = data.catalog.find((item) => item.id === provider);
  const presets = providerInfo?.models ?? [];
  const configured =
    provider === "fireworks"
      ? data.keys.fireworksConfigured
      : data.keys.openrouterConfigured;
  const isCustom = model.trim() !== "" && !presets.some((p) => p.id === model);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base">Modelo em uso</CardTitle>
            {data.config.source === "global" ? (
              <Badge>Vale para todos os usuários</Badge>
            ) : (
              <Badge variant="secondary">Padrão do servidor</Badge>
            )}
            {configured ? (
              <Badge variant="success">chave configurada</Badge>
            ) : (
              <Badge variant="warning">sem chave no servidor</Badge>
            )}
          </div>
          <CardDescription>
            Efetivo agora: <span className="font-medium">{data.config.provider}</span>
            {" · "}
            <span className="break-all font-mono text-xs">{data.config.model}</span>
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provedor e modelo</CardTitle>
          <CardDescription>
            Escolha o provedor e o modelo usados na análise de documentos. A
            chave fica só no servidor (.env).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ai-provider">Provedor</Label>
            <select
              id="ai-provider"
              value={provider}
              onChange={(event) =>
                handleProviderChange(event.target.value as AiProviderId)
              }
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {data.catalog.map((item) => (
                <option key={item.id} value={item.id} title={item.description}>
                  {item.name}
                </option>
              ))}
            </select>
            {providerInfo?.description && (
              <p className="text-xs text-muted-foreground">
                {providerInfo.description}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-model">
              Modelo ({providerInfo?.name ?? provider})
            </Label>
            <select
              id="ai-model"
              value={isCustom ? "__custom__" : model}
              onChange={(event) => {
                if (event.target.value !== "__custom__") setModel(event.target.value);
              }}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id} title={preset.hint}>
                  {preset.label}
                </option>
              ))}
              {isCustom && <option value="__custom__">Atual: {model}</option>}
            </select>
            <p className="break-all font-mono text-xs text-muted-foreground">{model}</p>
            {!configured && (
              <p className="text-sm text-amber-600">
                Atenção: sem a chave do {providerInfo?.name ?? provider} no
                servidor, as chamadas vão falhar (503). Salve mesmo assim ou peça
                ao responsável pelo deploy.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {message && (
        <p
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            message.kind === "ok"
              ? "border-primary/20 bg-primary/5"
              : "border-destructive/30 bg-destructive/5",
          )}
        >
          {message.kind === "ok" && <CircleCheck className="h-4 w-4 shrink-0 text-primary" />}
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void handleSave()} disabled={saving || !model.trim()}>
          {saving && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}
