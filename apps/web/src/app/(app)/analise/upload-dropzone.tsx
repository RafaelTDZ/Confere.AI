"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CloudUpload,
  Loader2,
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

const DOC_LABELS: Record<DocumentType, string> = {
  invoice: "Invoice",
  packing_list: "Packing List",
  bill_of_lading: "BL",
};

const TRACKED_TYPES: DocumentType[] = [
  "invoice",
  "packing_list",
  "bill_of_lading",
];

type AnalyzeResponse = {
  importId: string;
  types: DocumentType[];
  documents: Array<{ id: string; docType: DocumentType }>;
  invoice: InvoiceExtraction | null;
  model: string;
  latencyMs: number;
  error?: string;
};

function formatParty(
  label: string,
  party: { name: string | null; cnpj?: string | null; address?: string | null },
) {
  const parts = [
    party.name || "—",
    party.cnpj ? `CNPJ ${party.cnpj}` : null,
    party.address || null,
  ].filter(Boolean);
  return `${label}: ${parts.join(" · ")}`;
}

export function UploadDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [presentTypes, setPresentTypes] = useState<DocumentType[]>([]);
  const [invoice, setInvoice] = useState<InvoiceExtraction | null>(null);
  const [lastFileName, setLastFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setInfo(null);
    setInvoice(null);
    setLoading(true);
    setLastFileName(file.name);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        body: form,
      });

      const data = (await res.json()) as AnalyzeResponse;
      if (!res.ok) {
        throw new Error(data.error || "Falha ao analisar documento");
      }

      setPresentTypes(data.types);
      setInvoice(data.invoice);

      const typeLabels = data.types.map((t) => DOC_LABELS[t]).join(", ");
      if (data.invoice) {
        setInfo(
          `Tipos identificados: ${typeLabels}. Invoice ${data.invoice.number ?? "sem número"} extraída (${data.latencyMs} ms).`,
        );
      } else {
        setInfo(
          `Tipos identificados: ${typeLabels}. Nenhuma Invoice neste arquivo — extração de PL/BL virá nos próximos passos.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const receivedCount = TRACKED_TYPES.filter((t) =>
    presentTypes.includes(t),
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Enviar documentos</CardTitle>
        <CardDescription>
          A IA identifica o tipo de cada arquivo e extrai dados da Invoice
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
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
            "group flex min-h-64 w-full flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all",
            dragging
              ? "scale-[1.01] border-primary bg-primary/5"
              : "border-muted-foreground/25 bg-muted/30 hover:border-primary/60 hover:bg-primary/5",
            loading && "pointer-events-none opacity-70",
          )}
        >
          {loading ? (
            <>
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
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
                  PDF ou imagem (PNG, JPG) — um arquivo por vez, até 10 MB
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

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Documentos recebidos</span>
            <span>
              {receivedCount} de {TRACKED_TYPES.length}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{
                width: `${(receivedCount / TRACKED_TYPES.length) * 100}%`,
              }}
            />
          </div>
          <ul className="flex flex-wrap gap-2 pt-1">
            {TRACKED_TYPES.map((type) => {
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
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <CircleDashed className="h-3.5 w-3.5" />
                  )}
                  {DOC_LABELS[type]}
                  {type === "packing_list" && !present && (
                    <span className="font-normal opacity-70">(opcional)</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {invoice && (
          <div className="space-y-3 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
            <p className="font-medium">Invoice extraída</p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li>Número: {invoice.number ?? "—"}</li>
              <li>Exportador: {invoice.exporter.name ?? "—"}</li>
              <li>{formatParty("Importador / consignee", invoice.importer)}</li>
              <li>{formatParty("Adquirente / notify", invoice.notify)}</li>
            </ul>
            {invoice.products.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <p className="font-medium text-foreground">Produtos</p>
                <ul className="space-y-1 text-muted-foreground">
                  {invoice.products.map((product, index) => (
                    <li key={`${product.code ?? "p"}-${index}`}>
                      {[
                        product.code || "sem código",
                        product.ncm ? `NCM ${product.ncm}` : null,
                        product.description || null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {info && (
          <p className="rounded-md bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
            {info}
          </p>
        )}

        {error && (
          <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <CircleAlert className="h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
