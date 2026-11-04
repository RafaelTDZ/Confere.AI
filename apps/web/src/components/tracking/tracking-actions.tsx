"use client";

import { useState, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
      skipped?: "cooldown" | "arrived";
      retryAfterSeconds?: number;
    };
    if (!res.ok) {
      throw new Error(data.error || "Falha ao atualizar rastreio");
    }
    if (data.skipped === "arrived") {
      return {
        feedback: {
          type: "success",
          message:
            "Chegada confirmada — o rastreio automático foi concluído e não há mais consultas.",
        },
        refreshed: false,
      };
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

/** CTA de atualização para estados vazios (ex.: card de prazos sem ETA). */
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
  /** Página do formulário de evento manual (`/rastreio/<id>/evento`). */
  eventHref: string;
  canEdit: boolean;
};

/**
 * Ações do rastreio no cabeçalho do detalhe: atualizar a consulta no armador e
 * abrir a tela de evento manual. O formulário vive na rota `eventHref` — aqui
 * fica só o link. Retorna o grupo de botões e, quando há feedback da
 * atualização, um painel em largura total (filho de um container `flex-wrap`).
 */
export function TrackingActions({
  importId,
  eventHref,
  canEdit,
}: TrackingActionsProps): ReactElement {
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
        {canEdit ? (
          <Link
            href={eventHref}
            className={cn(
              buttonVariants({ variant: "outline", size: "sm" }),
              "min-h-11 sm:min-h-8",
            )}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Lançar evento manual
          </Link>
        ) : null}
      </div>

      {feedback ? (
        <Card className="basis-full">
          <CardContent className="p-4">
            <div aria-live="polite" role="status">
              <FeedbackMessage feedback={feedback} />
            </div>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
