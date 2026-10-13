"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RotateCcw, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AiProviderId } from "@/lib/ai/provider";
import type { ProviderInfo } from "@/lib/ai/catalog";

type AiSettingsPayload = {
  overrides: { provider?: AiProviderId; model?: string };
  config: { provider: AiProviderId; model: string; source: "global" | "env" };
  keys: { openrouterConfigured: boolean; fireworksConfigured: boolean };
  catalog: ProviderInfo[];
};

type HealthResult = {
  ok: boolean;
  provider: AiProviderId;
  model: string;
  text: string;
  latencyMs: number;
};

function keyConfigured(provider: AiProviderId, keys: AiSettingsPayload["keys"]) {
  return provider === "fireworks" ? keys.fireworksConfigured : keys.openrouterConfigured;
}

export function AiSettingsForm() {
  const [data, setData] = useState<AiSettingsPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [provider, setProvider] = useState<AiProviderId>("openrouter");
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [health, setHealth] = useState<HealthResult | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
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
    void load();
  }, [load]);

  function selectProvider(next: AiProviderId) {
    setProvider(next);
    setMessage(null);
    setHealth(null);
    const info = data?.catalog.find((p) => p.id === next);
    if (info?.models[0]) setModel(info.models[0].id);
  }

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
      setHealth(null);
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

  async function handleReset() {
    setResetting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/ai", { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as AiSettingsPayload & {
        error?: string;
      };
      if (!res.ok || !json) {
        throw new Error(json?.error ?? "Falha ao redefinir");
      }
      setData(json);
      setProvider(json.config.provider);
      setModel(json.config.model);
      setHealth(null);
      setMessage({ kind: "ok", text: "Voltou ao padrão do servidor." });
    } catch (error) {
      setMessage({
        kind: "err",
        text: error instanceof Error ? error.message : "Falha ao redefinir",
      });
    } finally {
      setResetting(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setHealth(null);
    setMessage(null);
    try {
      const res = await fetch("/api/ai/health", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as HealthResult & {
        error?: string;
      };
      if (!res.ok || !json || !("ok" in json)) {
        throw new Error(json?.error ?? "Falha no teste");
      }
      setHealth(json as HealthResult);
    } catch (error) {
      setMessage({
        kind: "err",
        text: error instanceof Error ? error.message : "Falha no teste",
      });
    } finally {
      setTesting(false);
    }
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Não foi possível carregar</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" onClick={() => void load()}>
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
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando configurações de IA…
        </CardContent>
      </Card>
    );
  }

  const providerInfo = data.catalog.find((p) => p.id === provider);
  const configured = keyConfigured(provider, data.keys);

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
          <CardTitle className="text-base">Provedor</CardTitle>
          <CardDescription>
            A chave de cada provedor fica só no servidor (.env).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {data.catalog.map((item) => {
            const active = provider === item.id;
            const ok = keyConfigured(item.id, data.keys);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectProvider(item.id)}
                aria-pressed={active}
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/5"
                    : "hover:border-muted-foreground/40",
                )}
              >
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-semibold">{item.name}</span>
                  {ok ? (
                    <Badge variant="success">chave configurada</Badge>
                  ) : (
                    <Badge variant="warning">sem chave no servidor</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modelo</CardTitle>
          <CardDescription>
            Escolha um preset ou informe o ID do modelo.{" "}
            {provider === "fireworks" &&
              "No Fireworks, PDFs diretos não funcionam — use PNG/JPG."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(providerInfo?.models ?? []).map((preset) => (
              <Button
                key={preset.id}
                type="button"
                variant={model === preset.id ? "default" : "outline"}
                size="sm"
                title={preset.hint}
                onClick={() => setModel(preset.id)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-model">ID do modelo</Label>
            <Input
              id="ai-model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={providerInfo?.models[0]?.id ?? ""}
              spellCheck={false}
              className="font-mono text-xs"
            />
          </div>
          {!configured && (
            <p className="text-sm text-amber-600">
              Atenção: sem chave deste provedor no servidor, as chamadas vão
              falhar (503). Salve mesmo assim ou peça ao responsável pelo deploy.
            </p>
          )}
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
          {message.kind === "ok" && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void handleSave()} disabled={saving || !model.trim()}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Salvar para todos
        </Button>
        {data.config.source === "global" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleReset()}
            disabled={resetting}
          >
            {resetting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="mr-2 h-4 w-4" />
            )}
            Voltar ao padrão do servidor
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={() => void handleTest()}
          disabled={testing}
        >
          {testing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FlaskConical className="mr-2 h-4 w-4" />
          )}
          Testar conexão
        </Button>
      </div>

      {health && (
        <Card>
          <CardContent className="space-y-1 pt-6 text-sm">
            <p>
              <span className="font-medium">Resposta:</span>{" "}
              <span className="font-mono">{health.text}</span>
            </p>
            <p className="text-muted-foreground">
              {health.provider} · <span className="break-all font-mono text-xs">{health.model}</span>
              {" · "}
              {health.latencyMs}ms
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
