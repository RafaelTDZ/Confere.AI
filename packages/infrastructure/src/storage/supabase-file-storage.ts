import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FileStorage,
  SignedUploadTarget,
} from "@confere/application";
import { DOCUMENTS_BUCKET } from "../supabase/service-client.js";

const SIGNED_DOWNLOAD_TTL_SECONDS = 60 * 15;

export class SupabaseFileStorage implements FileStorage {
  constructor(
    private readonly client: SupabaseClient,
    private readonly bucket: string = DOCUMENTS_BUCKET,
  ) {}

  async createSignedUploadUrl(path: string): Promise<SignedUploadTarget> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUploadUrl(path);
    if (error) {
      throw new Error(`Falha ao gerar signed URL de upload: ${error.message}`);
    }
    return { path, signedUrl: data.signedUrl, token: data.token };
  }

  async createSignedDownloadUrl(
    path: string,
    expiresInSeconds = SIGNED_DOWNLOAD_TTL_SECONDS,
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error) {
      throw new Error(
        `Falha ao gerar signed URL de download: ${error.message}`,
      );
    }
    return data.signedUrl;
  }

  async download(path: string): Promise<Uint8Array> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(path);
    if (error) {
      throw new Error(`Falha ao baixar arquivo ${path}: ${error.message}`);
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async exists(path: string): Promise<boolean> {
    const folder = path.split("/").slice(0, -1).join("/");
    const name = path.split("/").at(-1) ?? "";
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(folder, { search: name, limit: 1 });
    if (error) return false;
    return (data ?? []).some((entry) => entry.name === name);
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([path]);
    if (error) {
      throw new Error(`Falha ao remover arquivo ${path}: ${error.message}`);
    }
  }
}
