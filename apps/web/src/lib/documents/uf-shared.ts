/**
 * Normalizador de UF (client + server).
 *
 * O campo Estado das empresas guarda sempre a sigla da UF. Documentos e
 * cadastros antigos podem trazer o nome por extenso, minúsculas ou pontuação;
 * este módulo centraliza a conversão (`sc`, `Santa Catarina`, `SÃO PAULO` →
 * `SC`/`SP`) e devolve `null` para qualquer valor que não seja uma UF.
 */

type Uf = { code: string; name: string };

const UFS: readonly Uf[] = [
  { code: "AC", name: "Acre" },
  { code: "AL", name: "Alagoas" },
  { code: "AP", name: "Amapá" },
  { code: "AM", name: "Amazonas" },
  { code: "BA", name: "Bahia" },
  { code: "CE", name: "Ceará" },
  { code: "DF", name: "Distrito Federal" },
  { code: "ES", name: "Espírito Santo" },
  { code: "GO", name: "Goiás" },
  { code: "MA", name: "Maranhão" },
  { code: "MT", name: "Mato Grosso" },
  { code: "MS", name: "Mato Grosso do Sul" },
  { code: "MG", name: "Minas Gerais" },
  { code: "PA", name: "Pará" },
  { code: "PB", name: "Paraíba" },
  { code: "PR", name: "Paraná" },
  { code: "PE", name: "Pernambuco" },
  { code: "PI", name: "Piauí" },
  { code: "RJ", name: "Rio de Janeiro" },
  { code: "RN", name: "Rio Grande do Norte" },
  { code: "RS", name: "Rio Grande do Sul" },
  { code: "RO", name: "Rondônia" },
  { code: "RR", name: "Roraima" },
  { code: "SC", name: "Santa Catarina" },
  { code: "SP", name: "São Paulo" },
  { code: "SE", name: "Sergipe" },
  { code: "TO", name: "Tocantins" },
];

/** Texto comparável: sem acentos, sem espaços repetidos e em maiúsculas. */
function normalizeUfText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.\-_/]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

const UF_BY_CODE = new Map(UFS.map((uf) => [uf.code, uf.code] as const));
const UF_BY_NAME = new Map(
  UFS.map((uf) => [normalizeUfText(uf.name), uf.code] as const),
);

/**
 * Sigla da UF para `"sc"`, `" Sc "`, `"Santa Catarina"`, `"SÃO PAULO"` etc.
 * Devolve `null` quando o valor não corresponde a nenhuma das 27 UFs.
 */
export function normalizeUf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const text = normalizeUfText(value);
  if (!text) return null;

  const direct = UF_BY_CODE.get(text) ?? UF_BY_NAME.get(text);
  if (direct) return direct;

  // Aceita siglas separadas por pontuação/espaço ("S.C.", "S C").
  const compact = text.replace(/[^A-Z]/g, "");
  if (compact.length === 2) return UF_BY_CODE.get(compact) ?? null;

  return null;
}

/**
 * Valor exibido no input de UF: a sigla quando reconhecida; senão as duas
 * primeiras letras em maiúsculas, para permitir digitar sem limpar o campo.
 */
export function formatUfInput(value: string): string {
  return (
    normalizeUf(value) ??
    normalizeUfText(value)
      .replace(/[^A-Z]/g, "")
      .slice(0, 2)
  );
}
