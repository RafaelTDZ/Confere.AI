import { describe, expect, it } from "vitest";

import { formatDateBr } from "./import-edit-shared";

describe("formatDateBr", () => {
  it("mantém datas já no padrão brasileiro", () => {
    expect(formatDateBr("06/10/2026")).toBe("06/10/2026");
    expect(formatDateBr("6/10/2026")).toBe("06/10/2026");
    expect(formatDateBr("06/10/26")).toBe("06/10/2026");
    expect(formatDateBr("06-10-2026")).toBe("06/10/2026");
  });

  it("converte ISO (AAAA-MM-DD)", () => {
    expect(formatDateBr("2026-10-06")).toBe("06/10/2026");
    expect(formatDateBr("2026-01-31")).toBe("31/01/2026");
  });

  it("converte mês escrito em inglês", () => {
    expect(formatDateBr("OCT/06/2026")).toBe("06/10/2026");
    expect(formatDateBr("06 OCT 2026")).toBe("06/10/2026");
    expect(formatDateBr("OCT 6, 2026")).toBe("06/10/2026");
    expect(formatDateBr("SHIPPED ON BOARD 06 OCT 2026")).toBe("06/10/2026");
    expect(formatDateBr("06 OCT 26")).toBe("06/10/2026");
  });

  it("converte mês escrito em português", () => {
    expect(formatDateBr("06 OUT 2026")).toBe("06/10/2026");
    expect(formatDateBr("02 JAN 2026")).toBe("02/01/2026");
  });

  it("devolve vazio para valor ausente", () => {
    expect(formatDateBr(null)).toBe("");
    expect(formatDateBr(undefined)).toBe("");
    expect(formatDateBr("   ")).toBe("");
  });

  it("devolve o valor original quando não reconhece o formato", () => {
    expect(formatDateBr("a definir")).toBe("a definir");
    expect(formatDateBr("sem data")).toBe("sem data");
  });
});
