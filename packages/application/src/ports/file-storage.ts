export interface SignedUploadTarget {
  path: string;
  signedUrl: string;
  token: string;
}

export interface FileStorage {
  /** Gera URL assinada de curta duracao para upload direto do cliente. */
  createSignedUploadUrl(path: string): Promise<SignedUploadTarget>;
  /** Gera URL assinada de curta duracao para download/visualizacao. */
  createSignedDownloadUrl(path: string, expiresInSeconds: number): Promise<string>;
  /** Download server-side (worker). */
  download(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}
