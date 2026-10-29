import { describe, expect, it } from "vitest";
import { carrierFromBlPrefix, looksLikeCarrierBl } from "@/lib/tracking/bl-prefix";

describe("looksLikeCarrierBl", () => {
  it("reconhece os prefixos de BL de cada armador", () => {
    expect(looksLikeCarrierBl("maersk", "MAEU123456789")).toBe(true);
    expect(looksLikeCarrierBl("maersk", "MRKU123456789")).toBe(true);
    expect(looksLikeCarrierBl("msc", "MEDU1234567")).toBe(true);
    expect(looksLikeCarrierBl("msc", "MSCU1234567")).toBe(true);
    expect(looksLikeCarrierBl("cma", "CMDU1234567")).toBe(true);
    expect(looksLikeCarrierBl("cosco", "COSU6508676460")).toBe(true);
    expect(looksLikeCarrierBl("evergreen", "EGLV123456789")).toBe(true);
    expect(looksLikeCarrierBl("hapag", "HLCUSHA2502BAXD3")).toBe(true);
    expect(looksLikeCarrierBl("hmm", "HMMU123456789")).toBe(true);
    expect(looksLikeCarrierBl("one", "ONEYSZPGC3008300")).toBe(true);
    expect(looksLikeCarrierBl("oocl", "OOLU1234567890")).toBe(true);
  });

  it("ignora caixa, espaços e pontuação", () => {
    expect(looksLikeCarrierBl("hapag", " hlcu sha 2502-baxd3 ")).toBe(true);
    expect(looksLikeCarrierBl("one", "oneyszpgc3008300")).toBe(true);
  });

  it("reconhece o BL numérico da Maersk e da Evergreen", () => {
    expect(looksLikeCarrierBl("maersk", "276430227")).toBe(true);
    expect(looksLikeCarrierBl("evergreen", "143600393412")).toBe(true);
  });

  it("trata BL de casa (sem o prefixo) como não rastreável", () => {
    expect(looksLikeCarrierBl("msc", "PLIQD4H06868")).toBe(false);
    expect(looksLikeCarrierBl("hapag", "SASE3388881")).toBe(false);
    expect(looksLikeCarrierBl("cma", "PLISZ4H14434")).toBe(false);
    expect(looksLikeCarrierBl("hmm", "MSIRYOE261000021")).toBe(false);
    expect(looksLikeCarrierBl("maersk", "SASE3388881")).toBe(false);
  });

  it("não decide quando o armador é desconhecido", () => {
    expect(looksLikeCarrierBl("unknown", "PLIQD4H06868")).toBe(true);
    expect(looksLikeCarrierBl(undefined, "SASE3388881")).toBe(true);
    expect(looksLikeCarrierBl("unknown", null)).toBe(true);
  });

  it("devolve false para valor vazio de armador conhecido", () => {
    expect(looksLikeCarrierBl("maersk", null)).toBe(false);
    expect(looksLikeCarrierBl("maersk", "  ")).toBe(false);
  });
});

describe("carrierFromBlPrefix", () => {
  it("descobre o armador pelo prefixo do master", () => {
    expect(carrierFromBlPrefix("HLCUSHA2502BAXD3")).toBe("hapag");
    expect(carrierFromBlPrefix("oneyszpgc3008300")).toBe("one");
    expect(carrierFromBlPrefix("276430227")).toBe("maersk");
  });

  it("devolve null quando nenhum prefixo casa", () => {
    expect(carrierFromBlPrefix("PLIQD4H06868")).toBeNull();
    expect(carrierFromBlPrefix(null)).toBeNull();
  });
});
