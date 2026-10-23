"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheck,
  CircleAlert,
  CircleDashed,
  CloudUpload,
  LoaderCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DocumentType, InvoiceExtraction } from "@/lib/ai/schemas";
import {
  DOCUMENT_TYPE_LABELS,
  IMPORT_DOCUMENT_TYPES,
} from "@/lib/documents/imports-shared";
import { type PendingParty } from "@/lib/documents/parties-shared";

type AnalyzeResponse = {
  importId: string;
  types: DocumentType[];
  documents: Array<{ id: string; docType: DocumentType }>;
  invoice: InvoiceExtraction | null;
  extractionResultId: string | null;
  pendingParties?: PendingParty[];
  model: string;
  latencyMs: number;
  error?: string;
};

export function UploadDropzone({
  importId,
  initialTypes = [],
  embedded = false,
}: {
  importId?: string;
  initialTypes?: DocumentType[];
  embedded?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [presentTypes, setPresentTypes] = useState<DocumentType[]>(initialTypes);
  const [lastFileName, setLastFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setLoading(true);
    setLastFileName(file.name);

    try {
      const form = new FormData();
      form.append("file", file);
      if (importId) {
        form.append("importId", importId);
      }

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        body: form,
      });

      const data = (await res.json()) as AnalyzeResponse;
      if (!res.ok) {
        throw new Error(data.error || "Falha ao analisar documento");
      }

      setPresentTypes((current) => [
        ...new Set([...current, ...data.types]),
      ]);

      if (data.pendingParties && data.pendingParties.length > 0) {
        router.push(`/analise/${data.importId}/partes`);
        return;
      }

      if (importId) {
        router.refresh();
        return;
      }

      router.push(`/importacoes/${data.importId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const receivedCount = IMPORT_DOCUMENT_TYPES.filter((type) =>
    presentTypes.includes(type),
  ).length;

  const dropzone = (
    <>
      <button
        type="button"
        disabled={loading}
        onClick={() => inputRef.current?.click()}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const next = e.dataTransfer.files?.[0];
          if (next) void handleFile(next);
        }}
        className={cn(
          "group flex w-full flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 text-center transition-all",
          embedded ? "min-h-40 py-8" : "min-h-64 py-10",
          dragging
            ? "scale-[1.01] border-primary bg-primary/5"
            : "border-muted-foreground/25 bg-muted/30 hover:border-primary/60 hover:bg-primary/5",
          loading && "pointer-events-none opacity-70",
        )}
      >
        {loading ? (
          <>
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <LoaderCircle className="h-7 w-7 animate-spin text-primary" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">Analisando com IA...</p>
              <p className="text-xs text-muted-foreground">
                {lastFileName ?? "Classificando e extraindo dados"}
              </p>
            </div>
          </>
        ) : (
          <>
            <span
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-full transition-colors",
                dragging
                  ? "bg-primary/15 text-primary"
                  : "bg-primary/10 text-primary group-hover:bg-primary/15",
              )}
            >
              <CloudUpload className="h-7 w-7" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {dragging
                  ? "Solte o arquivo aqui"
                  : "Arraste um arquivo ou clique para selecionar"}
              </p>
              <p className="text-xs text-muted-foreground">
                {importId
                  ? "Invoice, BL ou Packing List desta operação — PDF ou imagem, até 10 MB"
                  : "PDF ou imagem (PNG, JPG) — um arquivo por vez, até 10 MB"}
              </p>
            </div>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const next = e.target.files?.[0];
          if (next) void handleFile(next);
        }}
      />

      {!embedded && presentTypes.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Documentos recebidos</span>
            <span>
              {receivedCount} de {IMPORT_DOCUMENT_TYPES.length}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{
                width: `${(receivedCount / IMPORT_DOCUMENT_TYPES.length) * 100}%`,
              }}
            />
          </div>
          <ul className="flex flex-wrap gap-2 pt-1">
            {IMPORT_DOCUMENT_TYPES.map((type) => {
              const present = presentTypes.includes(type);
              return (
                <li
                  key={type}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    present
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-border bg-muted/50 text-muted-foreground",
                  )}
                >
                  {present ? (
                    <CircleCheck className="h-3.5 w-3.5" />
                  ) : (
                    <CircleDashed className="h-3.5 w-3.5" />
                  )}
                  {DOCUMENT_TYPE_LABELS[type]}
                  {type === "packing_list" && !present && (
                    <span className="font-normal opacity-70">(opcional)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}
    </>
  );

  if (embedded) {
    return <div className="space-y-4">{dropzone}</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enviar documentos</CardTitle>
        <CardDescription>
          A IA identifica o tipo de cada arquivo e extrai dados da Invoice
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">{dropzone}</CardContent>
    </Card>
  );
}
