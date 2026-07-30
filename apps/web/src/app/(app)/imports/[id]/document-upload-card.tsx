"use client";

import { useRef, useState } from "react";
import { FileUp, Loader2 } from "lucide-react";
import type { DocumentType } from "@confere/domain";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BUCKET = "import-documents";

const DOC_LABELS: Record<DocumentType, string> = {
  invoice: "Commercial Invoice",
  packing_list: "Packing List",
  bill_of_lading: "Bill of Lading (BL)",
};

async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface UploadedDocument {
  id: string;
  docType: DocumentType;
  filename: string;
  version: number;
}

export function DocumentUploadCard({
  importId,
  docType,
  disabled,
  onUploaded,
}: {
  importId: string;
  docType: DocumentType;
  disabled: boolean;
  onUploaded: (doc: UploadedDocument) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedDocument | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);

    try {
      // 1. Registra documento e obtem signed URL
      const prepareResponse = await fetch(
        `/api/imports/${importId}/documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docType, filename: file.name }),
        },
      );
      if (!prepareResponse.ok) {
        const body = await prepareResponse.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Falha ao preparar upload");
      }
      const { data } = await prepareResponse.json();

      // 2. Upload direto ao Storage via signed URL
      const supabase = getSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(data.upload.path, data.upload.token, file, {
          contentType: file.type || "application/pdf",
        });
      if (uploadError) throw uploadError;

      // 3. Confirma com hash + metadados
      const hash = await sha256Hex(file);
      const confirmResponse = await fetch(
        `/api/documents/${data.document.id}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sha256: hash,
            contentType: file.type || "application/pdf",
            sizeBytes: file.size,
          }),
        },
      );
      if (!confirmResponse.ok) {
        const body = await confirmResponse.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Falha ao confirmar upload");
      }

      const uploadedDoc: UploadedDocument = {
        id: data.document.id,
        docType,
        filename: file.name,
        version: data.document.version,
      };
      setUploaded(uploadedDoc);
      onUploaded(uploadedDoc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{DOC_LABELS[docType]}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        {uploaded ? (
          <p className="text-sm text-green-700">
            {uploaded.filename} (v{uploaded.version}) enviado
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <FileUp className="h-4 w-4" />
                Selecionar PDF ou imagem
              </>
            )}
          </Button>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
