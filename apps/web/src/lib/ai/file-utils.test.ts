import { describe, expect, it } from "vitest";

import {
  assertAllowedFile,
  normalizeMediaType,
  sha256Hex,
} from "@/lib/ai/file-utils";

const TIPO_NAO_SUPORTADO =
  "Tipo de arquivo não suportado. Envie PDF, PNG, JPG ou WEBP.";

describe("normalizeMediaType", () => {
  it("normaliza image/jpg para image/jpeg", () => {
    expect(normalizeMediaType("image/jpg", "documento.pdf")).toBe("image/jpeg");
  });

  it.each([
    ["application/pdf", "application/pdf"],
    ["image/png", "image/png"],
    ["image/jpeg", "image/jpeg"],
    ["image/webp", "image/webp"],
  ])("aceita o content-type %s", (contentType, esperado) => {
    expect(normalizeMediaType(contentType, "arquivo.bin")).toBe(esperado);
  });

  it("ignora parâmetros e espaços do content-type", () => {
    expect(
      normalizeMediaType(" Application/PDF ; charset=binary", "arquivo.pdf"),
    ).toBe("application/pdf");
    expect(normalizeMediaType("  IMAGE/PNG  ", "arquivo.png")).toBe("image/png");
  });

  it.each([
    ["nota.pdf", "application/pdf"],
    ["foto.png", "image/png"],
    ["foto.jpg", "image/jpeg"],
    ["foto.jpeg", "image/jpeg"],
    ["foto.webp", "image/webp"],
    ["FOTO.JPG", "image/jpeg"],
  ])(
    "infere o tipo pela extensão quando o content-type está vazio (%s)",
    (filename, esperado) => {
      expect(normalizeMediaType("", filename)).toBe(esperado);
      expect(normalizeMediaType(null, filename)).toBe(esperado);
      expect(normalizeMediaType(undefined, filename)).toBe(esperado);
    },
  );

  it("infere o tipo pela extensão quando o content-type é desconhecido", () => {
    expect(
      normalizeMediaType("application/octet-stream", "documento.PDF"),
    ).toBe("application/pdf");
  });

  it("rejeita extensão e content-type não suportados", () => {
    expect(() => normalizeMediaType("", "planilha.xlsx")).toThrow(
      TIPO_NAO_SUPORTADO,
    );
    expect(() => normalizeMediaType("text/plain", "nota.txt")).toThrow(
      TIPO_NAO_SUPORTADO,
    );
    expect(() => normalizeMediaType(undefined, "sem-extensao")).toThrow(
      TIPO_NAO_SUPORTADO,
    );
  });
});

describe("assertAllowedFile", () => {
  it("rejeita arquivo com 0 bytes", () => {
    expect(() => assertAllowedFile(0, "application/pdf")).toThrow(
      "Arquivo vazio",
    );
  });

  it("rejeita tamanho negativo como arquivo vazio", () => {
    expect(() => assertAllowedFile(-1, "application/pdf")).toThrow(
      "Arquivo vazio",
    );
  });

  it("aceita um PDF pequeno", () => {
    expect(() => assertAllowedFile(1024, "application/pdf")).not.toThrow();
  });

  it("aceita exatamente 10 MB", () => {
    expect(() =>
      assertAllowedFile(10 * 1024 * 1024, "application/pdf"),
    ).not.toThrow();
  });

  it("rejeita arquivo maior que 10 MB", () => {
    expect(() =>
      assertAllowedFile(10 * 1024 * 1024 + 1, "application/pdf"),
    ).toThrow("Arquivo maior que 10 MB");
  });

  it("rejeita tipo não suportado", () => {
    expect(() => assertAllowedFile(1024, "text/plain")).toThrow(
      TIPO_NAO_SUPORTADO,
    );
  });

  it("aceita image/jpeg mesmo após a normalização", () => {
    expect(() => assertAllowedFile(1024, "image/jpeg")).not.toThrow();
  });
});

describe("sha256Hex", () => {
  it("gera o hash hexadecimal de bytes conhecidos", () => {
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });

  it("gera o hash de um texto em UTF-8", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("gera o hash de um buffer vazio", () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("retorna 64 caracteres hexadecimais minúsculos", () => {
    const hash = sha256Hex(new Uint8Array([1, 2, 3]));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
