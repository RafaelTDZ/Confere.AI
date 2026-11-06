"use client";

import { useEffect, useState, type ReactElement } from "react";
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

/**
 * Segundos desde o início da consulta. O portal do armador leva 10–60s, então
 * sem um contador o botão parece travado. O relógio só avança dentro do timer
 * (nada de `Date.now()` no render, que quebra a pureza exigida pelo React).
 */
function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (startedAt === null || now <= startedAt) return 0;
  return Math.floor((now - startedAt) / 1_000);
}

/** Dica exibida enquanto o portal responde (a consulta pode demorar ~1 min). */
const REFRESH_HINT =
  "Consultando o portal do armador — pode levar até 1 minuto.";

/** Consulta o armador agora; respeita o cooldown por importação do servidor. */
async function requestTrackingRefresh(
  importId: string,
): Promise<RefreshOutcome> {
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
      const minutes = Math.max(
        1,
        Math.ceil((data.retryAfterSeconds ?? 0) / 60),
      );
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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const isRefreshing = startedAt !== null;
  const elapsedSeconds = useElapsedSeconds(startedAt);

  async function handleRefresh() {
    if (!canEdit || isRefreshing) return;
    setFeedback(null);
    setStartedAt(Date.now());
    const outcome = await requestTrackingRefresh(importId);
    setFeedback(outcome.feedback);
    setStartedAt(null);
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
        {isRefreshing ? "Consultando armador..." : "Consultar armador"}
        {isRefreshing ? (
          <span aria-hidden="true" className="text-xs tabular-nums opacity-70">
            {elapsedSeconds}s
          </span>
        ) : null}
      </Button>
      <div role="status" aria-live="polite" className="w-full">
        {isRefreshing ? (
          <p className="text-center text-xs text-muted-foreground">
            {REFRESH_HINT}
          </p>
        ) : null}
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
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const isRefreshing = startedAt !== null;
  const elapsedSeconds = useElapsedSeconds(startedAt);

  async function handleRefresh() {
    if (!canEdit || isRefreshing) return;
    setFeedback(null);
    setStartedAt(Date.now());
    const outcome = await requestTrackingRefresh(importId);
    setFeedback(outcome.feedback);
    setStartedAt(null);
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
          {isRefreshing ? (
            <span
              aria-hidden="true"
              className="text-xs tabular-nums opacity-70"
            >
              {elapsedSeconds}s
            </span>
          ) : null}
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

      {isRefreshing || feedback ? (
        <Card className="basis-full">
          <CardContent className="p-4">
            {isRefreshing ? (
              <p
                role="status"
                aria-live="polite"
                className="text-sm text-muted-foreground"
              >
                {REFRESH_HINT}
              </p>
            ) : (
              <div aria-live="polite" role="status">
                <FeedbackMessage feedback={feedback} />
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
