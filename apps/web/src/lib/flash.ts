const FLASH_KEY = "confere:flash";

/**
 * Mensagem de confirmação de uma ação (ex.: "Importação atualizada"). Fica no
 * `sessionStorage` — por aba e consumida uma única vez — em vez de ir na URL:
 * com `?saved=ok` o aviso reaparecia ao voltar de um detalhe para a lista.
 */
export function setFlash(message: string): void {
  try {
    window.sessionStorage.setItem(FLASH_KEY, message);
  } catch {
    // Modo privado / storage bloqueado: sem aviso, mas a ação já foi concluída.
  }
}

/** Lê e apaga a mensagem pendente (para não reaparecer na próxima visita). */
export function takeFlash(): string | null {
  try {
    const message = window.sessionStorage.getItem(FLASH_KEY);
    if (message) window.sessionStorage.removeItem(FLASH_KEY);
    return message;
  } catch {
    return null;
  }
}
