import { describe, expect, it } from "vitest";
import {
  formatTrackingDate,
  formatTrackingMoment,
  isInTransitTrackingStatus,
  isTerminalTrackingStatus,
  normalizeTrackingListFilter,
  trackingDaysUntilEta,
  trackingEtaRelative,
  trackingListHref,
  trackingNextCheckLabel,
  trackingStatusLabel,
} from "@/lib/tracking/shared";

describe("trackingStatusLabel", () => {
  it("traduz status conhecidos", () => {
    expect(trackingStatusLabel("in_transit")).toEqual({
      label: "Em trânsito",
      variant: "default",
    });
    expect(trackingStatusLabel("delivered").label).toBe("Entregue");
  });

  it("cai para o valor bruto quando o status é desconhecido", () => {
    expect(trackingStatusLabel("custom_status")).toEqual({
      label: "custom_status",
      variant: "outline",
    });
  });
});

describe("isTerminalTrackingStatus", () => {
  it("considera entregue e vazio devolvido como finais", () => {
    expect(isTerminalTrackingStatus("delivered")).toBe(true);
    expect(isTerminalTrackingStatus("empty_returned")).toBe(true);
    expect(isTerminalTrackingStatus("in_transit")).toBe(false);
  });
});

describe("isInTransitTrackingStatus", () => {
  it("considera em trânsito e transbordo", () => {
    expect(isInTransitTrackingStatus("in_transit")).toBe(true);
    expect(isInTransitTrackingStatus("transshipment")).toBe(true);
    expect(isInTransitTrackingStatus("delivered")).toBe(false);
    expect(isInTransitTrackingStatus("pending")).toBe(false);
  });
});

describe("trackingNextCheckLabel", () => {
  it("mostra a data agendada quando existe", () => {
    expect(trackingNextCheckLabel("in_transit", "2026-11-02")).toBe(
      "02/11/2026",
    );
  });

  it("só usa 'Concluído' em status final", () => {
    expect(trackingNextCheckLabel("delivered", null)).toBe("Concluído");
    expect(trackingNextCheckLabel("empty_returned", null)).toBe("Concluído");
    expect(trackingNextCheckLabel("in_transit", null)).toBe(
      "Aguardando consulta",
    );
    expect(trackingNextCheckLabel("blocked", null)).toBe(
      "Aguardando consulta",
    );
  });
});

describe("normalizeTrackingListFilter", () => {
  it("mantém filtros conhecidos e cai em 'todos' para valor inválido", () => {
    expect(normalizeTrackingListFilter("chegando")).toBe("chegando");
    expect(normalizeTrackingListFilter("sem_consulta")).toBe("sem_consulta");
    expect(normalizeTrackingListFilter("invalido")).toBe("todos");
    expect(normalizeTrackingListFilter(null)).toBe("todos");
    expect(normalizeTrackingListFilter(undefined)).toBe("todos");
  });
});

describe("trackingListHref", () => {
  it("preserva a importação e omite o filtro padrão", () => {
    expect(trackingListHref({ importId: "imp-1" })).toBe(
      "/rastreio?import=imp-1",
    );
    expect(
      trackingListHref({ importId: "imp-1", filter: "todos" }),
    ).toBe("/rastreio?import=imp-1");
    expect(
      trackingListHref({ importId: "imp-1", filter: "chegando" }),
    ).toBe("/rastreio?import=imp-1&filtro=chegando");
  });

  it("sem importação devolve a raiz ou só o filtro", () => {
    expect(trackingListHref({})).toBe("/rastreio");
    expect(trackingListHref({ filter: "sem_eta" })).toBe(
      "/rastreio?filtro=sem_eta",
    );
    expect(trackingListHref({ importId: "   " })).toBe("/rastreio");
  });
});

describe("formatTrackingDate", () => {
  it("converte ISO e mantém pt-BR sem passar por Date", () => {
    expect(formatTrackingDate("2026-11-02")).toBe("02/11/2026");
    expect(formatTrackingDate("2026-11-02T23:00:00.000Z")).toBe("02/11/2026");
    expect(formatTrackingDate("02/11/2026")).toBe("02/11/2026");
    expect(formatTrackingDate(null)).toBeNull();
    expect(formatTrackingDate("")).toBeNull();
  });

  it("formata timestamps e devolve o valor cru quando não é data", () => {
    expect(formatTrackingDate("2026-11-02T14:30:00")).toContain("02/11/2026");
    expect(formatTrackingDate("sem data")).toBe("sem data");
  });
});

describe("formatTrackingMoment", () => {
  it("data pura não ganha horário", () => {
    expect(formatTrackingMoment("2026-11-02")).toBe("02/11/2026");
    expect(formatTrackingMoment("02/11/2026")).toBe("02/11/2026");
  });

  it("timestamp local mostra data e hora", () => {
    const formatted = formatTrackingMoment("2026-11-02T14:30:00");
    expect(formatted).toContain("02/11/2026");
    expect(formatted).toContain("14:30");
  });

  it("valor inválido cai para a data crua e vazio vira null", () => {
    expect(formatTrackingMoment("sem data")).toBe("sem data");
    expect(formatTrackingMoment(null)).toBeNull();
  });
});

describe("trackingDaysUntilEta/trackingEtaHint", () => {
  const now = new Date(2026, 9, 28, 12, 0, 0);

  it("calcula dias locais a partir de ISO e pt-BR", () => {
    expect(trackingDaysUntilEta("2026-11-02", now)).toBe(5);
    expect(trackingDaysUntilEta("02/11/2026", now)).toBe(5);
    expect(trackingDaysUntilEta("2026-10-27", now)).toBe(-1);
    expect(trackingDaysUntilEta(null, now)).toBeNull();
    expect(trackingDaysUntilEta("sem data", now)).toBeNull();
  });

  it("traduz o ETA de embarque em trânsito em texto curto", () => {
    expect(trackingEtaRelative("2026-10-28", "in_transit", now)).toEqual({
      label: "hoje",
      tone: "muted",
    });
    expect(trackingEtaRelative("2026-10-29", "transshipment", now)).toEqual({
      label: "em 1 dia",
      tone: "muted",
    });
    expect(trackingEtaRelative("2026-11-02", "in_transit", now)).toEqual({
      label: "em 5 dias",
      tone: "muted",
    });
    expect(trackingEtaRelative("2026-10-27", "in_transit", now)).toEqual({
      label: "atrasado 1 dia",
      tone: "danger",
    });
    expect(trackingEtaRelative("2026-10-24", "in_transit", now)).toEqual({
      label: "atrasado 4 dias",
      tone: "danger",
    });
    expect(trackingEtaRelative(null, "in_transit", now)).toBeNull();
  });

  it("não acusa atraso em embarque já chegado ou entregue", () => {
    expect(trackingEtaRelative("2026-10-24", "discharged", now)).toBeNull();
    expect(trackingEtaRelative("2026-10-24", "delivered", now)).toBeNull();
    expect(trackingEtaRelative("2026-11-02", "arrived", now)).toBeNull();
  });
});
