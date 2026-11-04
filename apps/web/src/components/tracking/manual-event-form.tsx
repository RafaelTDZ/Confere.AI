"use client";

import { useState, type FormEvent } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { validateManualTrackingEvent } from "@/lib/tracking/manual-event";
import { cn } from "@/lib/utils";

type ManualTrackingEventFormProps = {
  importId: string;
  /** Para onde "Cancelar" leva (o processo da importação). */
  cancelHref: string;
  /** Para onde ir depois de salvar (o detalhe do rastreio, com o histórico). */
  afterSaveHref: string;
};

/**
 * Formulário de evento manual de rastreio. Vive em `/rastreio/<id>/evento`, fora
 * do detalhe, para não disputar espaço com o cabeçalho nem com o histórico.
 *
 * A escrita acontece em `POST /api/imports/[id]/tracking/events` (owner/admin/
 * operator; viewer nem chega aqui — a página bloqueia antes). Depois de salvar
 * volta para o detalhe já atualizado.
 */
export function ManualTrackingEventForm({
  importId,
  cancelHref,
  afterSaveHref,
}: ManualTrackingEventFormProps) {
  const router = useRouter();
  const [eventAt, setEventAt] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [containerNumber, setContainerNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) return;

    const validation = validateManualTrackingEvent({
      eventAt,
      description,
      location,
      containerNumber,
    });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setError(null);
    setIsSaving(true);
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
      router.push(afterSaveHref);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Erro inesperado",
      );
      setIsSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Novo evento</CardTitle>
        <CardDescription>
          Use quando o portal do armador não liberar o rastreio. O evento entra
          no histórico como lançamento manual.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tracking-event-date">Data do evento</Label>
              <Input
                id="tracking-event-date"
                type="date"
                value={eventAt}
                onChange={(event) => setEventAt(event.target.value)}
                disabled={isSaving}
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
                onChange={(event) => setContainerNumber(event.target.value)}
                disabled={isSaving}
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
                disabled={isSaving}
                required
                placeholder="Ex.: Container descarregado no porto de Santos"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tracking-event-location">Local (opcional)</Label>
              <Input
                id="tracking-event-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                disabled={isSaving}
                placeholder="Ex.: Porto de Santos - SP"
              />
            </div>
          </div>

          <div role="status" aria-live="polite">
            {error ? (
              <p className="flex items-center gap-2 rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive-text">
                <CircleAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap justify-end gap-2">
            <Link
              href={cancelHref}
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Cancelar
            </Link>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? (
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
      </CardContent>
    </Card>
  );
}
