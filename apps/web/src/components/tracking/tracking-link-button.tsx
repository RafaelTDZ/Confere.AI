"use client";

import { useEffect, useState, type ReactElement } from "react";
import Link from "next/link";
import { LoaderCircle, Ship } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  toTimestamp,
  useElapsedSeconds,
} from "@/components/tracking/use-elapsed-seconds";

type TrackingStatus = { active: boolean; since: string | null };

const POLL_INTERVAL_MS = 5_000;
/** Para de acompanhar depois disso (job ficou `stale`, cron assume). */
const MAX_POLLS = 60;

/**
 * Botão "Rastrear" do formulário do BL. Enquanto a consulta ao armador roda
 * (`queued`/`running`), vira spinner com o tempo decorrido; o estado pode ter
 * começado antes da página abrir (primeira consulta da análise), então o
 * servidor manda o `since` e o polling acompanha o fim.
 */
export function TrackingLinkButton({
  importId,
  href,
  initialActive,
  initialSince,
}: {
  importId: string;
  href: string;
  initialActive: boolean;
  initialSince: string | null;
}): ReactElement {
  const [status, setStatus] = useState<TrackingStatus>({
    active: initialActive,
    since: initialSince,
  });
  const elapsedSeconds = useElapsedSeconds(
    status.active ? toTimestamp(status.since) : null,
  );

  useEffect(() => {
    if (!status.active) return;
    let polls = 0;
    let cancelled = false;

    async function check() {
      polls += 1;
      try {
        const res = await fetch(`/api/imports/${importId}/tracking/status`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as TrackingStatus;
        if (cancelled) return;
        if (data.active) {
          setStatus({ active: true, since: data.since ?? status.since });
        } else {
          setStatus({ active: false, since: null });
        }
      } catch {
        // Rede instável: mantém o estado atual e tenta no próximo ciclo.
      }
    }

    const timer = setInterval(() => {
      if (polls >= MAX_POLLS) {
        clearInterval(timer);
        return;
      }
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status.active, status.since, importId]);

  return (
    <Link
      href={href}
      aria-label={
        status.active ? "Rastreio em andamento — abrir" : "Abrir rastreio"
      }
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "min-h-11 shrink-0 sm:min-h-8",
      )}
    >
      {status.active ? (
        <LoaderCircle
          aria-hidden="true"
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <Ship aria-hidden="true" className="h-4 w-4" />
      )}
      {status.active ? "Rastreando..." : "Rastrear"}
      {status.active ? (
        <span aria-hidden="true" className="text-xs tabular-nums opacity-70">
          {elapsedSeconds}s
        </span>
      ) : null}
    </Link>
  );
}
