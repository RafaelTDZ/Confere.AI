/**
 * Stub do pacote `server-only` para o Vitest.
 *
 * Em produção, `import "server-only"` quebra o build quando o módulo entra no
 * bundle do cliente. No Node (testes) o pacote original lança sempre, então o
 * `vitest.config.ts` resolve `server-only` para este arquivo vazio.
 */
export {};
