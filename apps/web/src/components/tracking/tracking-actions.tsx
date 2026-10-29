"use client";

import { useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateManualTrackingEvent } from "@/lib/tracking/manual-event";
import { cn } from "@/lib/utils";

type Feedback = { type: "success" | "error"; message: string } | null;

type RefreshOutcome = {
  feedback: { type: "success" | "error"; message: string };
  /** Só recarrega a tela quando a consulta de fato rodou. */
  refreshed: boolean;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Consulta o armador agora; respeita o cooldown por importação do servidor. */
async function requestTrackingRefresh(importId: string): Promise<RefreshOutcome> {
  try {
    const res = await fetch(`/api/imports/${importId}/tracking/refresh`, {
      method: "POST",
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      skipped?: "cooldown";
      retryAfterSeconds?: number;
    };
    if (!res.ok) {
      throw new Error(data.error || "Falha ao atualizar rastreio");
    }
    if (data.skipped === "cooldown") {
      const minutes = Math.max(1, Math.ceil((data.retryAfterSeconds ?? 0) / 60));
      return {
        feedback: {
          type: "success",
          message: `Consulta recente — tente novamente em ${minutes} min.`,
        },
        refreshed: false,
      };
    }
    return {
      feedback: { type: "success", message: "Rastreio atualizado." },
      refreshed: true,
    };
  } catch (error) {
    return {
      feedback: {
        type: "error",
        message: errorMessage(error, "Erro inesperado"),
      },
      refreshed: false,
    };
  }
}

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  const isError = feedback.type === "error";
  return (
    <p
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
        isError
          ? "bg-destructive-soft text-destructive-text"
          : "bg-primary-soft text-primary-text",
      )}
    >
      {isError ? (
        <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
      ) : (
        <CircleCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
      )}
      {feedback.message}
    </p>
  );
}

/** CTA de atualização para estados vazios (ex.: timeline sem ETA). */
export function TrackingRefreshButton({
  importId,
  canEdit,
}: {
  importId: string;
  canEdit: boolean;
}): ReactElement {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  async function handleRefresh() {
    if (!canEdit || isRefreshing) return;
    setFeedback(null);
    setIsRefreshing(true);
    const outcome = await requestTrackingRefresh(importId);
    setFeedback(outcome.feedback);
    setIsRefreshing(false);
    if (outcome.refreshed) router.refresh();
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-8"
        onClick={handleRefresh}
        disabled={!canEdit || isRefreshing}
      >
        {isRefreshing ? (
          <LoaderCircle
            aria-hidden="true"
            className="h-4 w-4 animate-spin motion-reduce:animate-none"
          />
        ) : (
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
        )}
        {isRefreshing ? "Atualizando..." : "Consultar armador"}
      </Button>
      <div role="status" aria-live="polite" className="w-full">
        <FeedbackMessage feedback={feedback} />
      </div>
    </div>
  );
}

type TrackingActionsProps = {
  importId: string;
  canEdit: boolean;
};

/**
 * Ações do rastreio no cabeçalho do detalhe: atualizar a consulta no armador e
 * lançar evento manual. Retorna o grupo de botões e, quando aberto, um painel
 * em largura total — pensado como filho direto de um container `flex-wrap`.
 * A importação mantém apenas o botão "Rastrear".
 */
export function TrackingActions({
  importId,
  canEdit,
}: TrackingActionsProps): ReactElement {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [isSavingEvent, setIsSavingEvent] = useState(false);
  const [eventAt, setEventAt] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [containerNumber, setContainerNumber] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);

  const fieldsDisabled = !canEdit || isSavingEvent;

  function resetManualForm() {
    setEventAt("");
    setDescription("");
    setLocation("");
    setContainerNumber("");
  }

  async function handleRefresh() {
    if (!canEdit || isRefreshing) return;
    setFeedback(null);
    setIsRefreshing(true);
    const outcome = await requestTrackingRefresh(importId);
    setFeedback(outcome.feedback);
    setIsRefreshing(false);
    if (outcome.refreshed) router.refresh();
  }

  async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || isSavingEvent) return;

    const validation = validateManualTrackingEvent({
      eventAt,
      description,
      location,
      containerNumber,
    });
    if (!validation.ok) {
      setFeedback({ type: "error", message: validation.error });
      return;
    }

    setFeedback(null);
    setIsSavingEvent(true);
    try {
      const res = await fetch(`/api/imports/${importId}/tracking/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.payload),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Falha ao salvar evento");
      }
      resetManualForm();
      setIsManualOpen(false);
      setFeedback({ type: "success", message: "Evento manual registrado." });
      router.refresh();
    } catch (error) {
      setFeedback({
        type: "error",
        message: errorMessage(error, "Erro inesperado"),
      });
    } finally {
      setIsSavingEvent(false);
    }
  }

  function handleCloseManualForm() {
    resetManualForm();
    setIsManualOpen(false);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          onClick={handleRefresh}
          disabled={!canEdit || isRefreshing}
        >
          {isRefreshing ? (
            <LoaderCircle
              aria-hidden="true"
              className="h-4 w-4 animate-spin motion-reduce:animate-none"
            />
          ) : (
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
          )}
          {isRefreshing ? "Atualizando..." : "Atualizar"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11 sm:min-h-8"
          aria-expanded={isManualOpen}
          aria-controls="tracking-manual-event-form"
          onClick={() => setIsManualOpen((previous) => !previous)}
          disabled={!canEdit}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          Lançar evento manual
        </Button>
      </div>

      {feedback || isManualOpen ? (
        <Card className="basis-full">
          <CardContent className="space-y-4 p-4">
            <div aria-live="polite" role="status">
              <FeedbackMessage feedback={feedback} />
            </div>

            {isManualOpen ? (
              <form
                id="tracking-manual-event-form"
                onSubmit={handleManualSubmit}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">Novo evento manual</p>
                  <p className="text-xs text-muted-foreground">
                    Use quando o portal do armador não liberar o rastreio.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tracking-event-date">Data do evento</Label>
                    <Input
                      id="tracking-event-date"
                      type="date"
                      value={eventAt}
                      onChange={(event) => setEventAt(event.target.value)}
                      disabled={fieldsDisabled}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tracking-event-container">
                      Container (opcional)
                    </Label>
                    <Input
                      id="tracking-event-container"
                      value={containerNumber}
                      onChange={(event) =>
                        setContainerNumber(event.target.value)
                      }
                      disabled={fieldsDisabled}
                      placeholder="—"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="tracking-event-description">
                      Descrição
                      <span className="ml-1 text-destructive-text" aria-hidden="true">
                        *
                      </span>
                    </Label>
                    <Input
                      id="tracking-event-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      disabled={fieldsDisabled}
                      required
                      placeholder="Ex.: Container descarregado no porto de Santos"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="tracking-event-location">
                      Local (opcional)
                    </Label>
                    <Input
                      id="tracking-event-location"
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                      disabled={fieldsDisabled}
                      placeholder="Ex.: Porto de Santos - SP"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCloseManualForm}
                    disabled={isSavingEvent}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" size="sm" disabled={fieldsDisabled}>
                    {isSavingEvent ? (
                      <>
                        <LoaderCircle
                          aria-hidden="true"
                          className="h-4 w-4 animate-spin motion-reduce:animate-none"
                        />
                        Salvando...
                      </>
                    ) : (
                      "Salvar evento"
                    )}
                  </Button>
                </div>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
