import type { CarrierCode } from "@/lib/tracking/carriers";
import { normalizeTrackingNumber } from "@/lib/tracking/validate";

/**
 * Formatos de BL emitidos pelo **armador** (master). O BL de casa do agente de
 * carga (forwarder/NVOCC) normalmente não segue nenhum destes formatos — é por
 * isso que só o master existe no portal do armador.
 *
 * Maersk e Evergreen emitem BL puramente numérico (9 e 12 dígitos). Sem esses
 * padrões, os BLs já validados (`276430227` e `143600393412`) seriam tratados
 * como BL de casa e a consulta cairia no container sem necessidade.
 */
const CARRIER_BL_PATTERNS: Partial<Record<CarrierCode, readonly RegExp[]>> = {
  maersk: [/^MAEU/, /^MRKU/, /^\d{9}$/],
  msc: [/^MEDU/, /^MSCU/],
  cma: [/^CMDU/],
  cosco: [/^COSU/],
  evergreen: [/^EGLV/, /^\d{12}$/],
  hapag: [/^HLCU/],
  hmm: [/^HMMU/],
  one: [/^ONEY/],
  oocl: [/^OOLU/],
};

/**
 * `true` quando o número parece ser um BL emitido pelo armador (começa com um
 * prefixo/ formato conhecido). Armador sem prefixo mapeado (`unknown`) devolve
 * `true`: sem informação não dá para classificar o BL como "de casa".
 */
export function looksLikeCarrierBl(
  carrier: CarrierCode | null | undefined,
  value: string | null | undefined,
): boolean {
  const patterns = CARRIER_BL_PATTERNS[carrier ?? "unknown"];
  if (!patterns || patterns.length === 0) return true;

  const normalized = normalizeTrackingNumber(value);
  if (!normalized) return false;

  return patterns.some((pattern) => pattern.test(normalized));
}

/** Armador reconhecido pelo prefixo do master BL (útil quando o texto não ajuda). */
export function carrierFromBlPrefix(
  value: string | null | undefined,
): CarrierCode | null {
  const normalized = normalizeTrackingNumber(value);
  if (!normalized) return null;

  for (const [carrier, patterns] of Object.entries(CARRIER_BL_PATTERNS)) {
    if (patterns?.some((pattern) => pattern.test(normalized))) {
      return carrier as CarrierCode;
    }
  }

  return null;
}
