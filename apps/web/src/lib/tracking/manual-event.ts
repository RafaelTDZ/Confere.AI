/**
 * Validação do formulário de evento manual de rastreio.
 * Módulo puro (sem `server-only`), compartilhado entre client e testes.
 */

export type ManualTrackingEventDraft = {
  /** `input type="date"` (YYYY-MM-DD). */
  eventAt: string;
  description: string;
  location?: string;
  containerNumber?: string;
};

type ManualTrackingEventPayload = {
  eventAt: string;
  description: string;
  location: string | null;
  containerNumber: string | null;
};

export type ManualTrackingEventValidation =
  | { ok: true; payload: ManualTrackingEventPayload }
  | { ok: false; error: string };

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Data e descrição são obrigatórias; os demais campos vão como `null` se vazios. */
export function validateManualTrackingEvent(
  draft: ManualTrackingEventDraft,
): ManualTrackingEventValidation {
  const eventAt = draft.eventAt.trim();
  if (!eventAt) {
    return { ok: false, error: "Informe a data do evento." };
  }
  if (!DATE_ONLY_PATTERN.test(eventAt)) {
    return { ok: false, error: "Data do evento inválida." };
  }

  const description = draft.description.trim();
  if (!description) {
    return { ok: false, error: "Descreva o evento." };
  }

  return {
    ok: true,
    payload: {
      eventAt,
      description,
      location: trimmedOrNull(draft.location),
      containerNumber: trimmedOrNull(draft.containerNumber),
    },
  };
}
