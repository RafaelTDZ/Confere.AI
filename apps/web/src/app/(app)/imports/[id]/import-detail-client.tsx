"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Play } from "lucide-react";
import type { DocumentType } from "@confere/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DocumentUploadCard, type UploadedDocument } from "./document-upload-card";
import { ReviewReport } from "./review-report";

const REQUIRED_DOCS: DocumentType[] = [
  "invoice",
  "packing_list",
  "bill_of_lading",
];

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Aguardando documentos",
  processing: "Processando com IA",
  awaiting_review: "Revisao pendente",
  completed: "Concluida",
  rejected: "Rejeitada",
};

export function ImportDetailClient({
  importId,
  initialStatus,
  referenceNumber,
  supplierName,
  incoterm,
  currency,
}: {
  importId: string;
  initialStatus: string;
  referenceNumber: string;
  supplierName: string | null;
  incoterm: string | null;
  currency: string | null;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [uploadedDocs, setUploadedDocs] = useState<
    Partial<Record<DocumentType, UploadedDocument>>
  >({});
  const [report, setReport] = useState<unknown | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allDocsUploaded = useMemo(
    () => REQUIRED_DOCS.every((docType) => uploadedDocs[docType]),
    [uploadedDocs],
  );

  const loadReport = useCallback(async () => {
    const response = await fetch(`/api/imports/${importId}/report`);
    if (!response.ok) return;
    const body = await response.json();
    setReport(body.data);
    setStatus(body.data.import.status);
  }, [importId]);

  // Polling enquanto processando
  useEffect(() => {
    if (status !== "processing") return;
    const interval = setInterval(() => {
      void loadReport();
    }, 4000);
    return () => clearInterval(interval);
  }, [status, loadReport]);

  // Carrega documentos existentes ao montar
  useEffect(() => {
    void (async () => {
      const response = await fetch(`/api/imports/${importId}`);
      if (!response.ok) return;
      const body = await response.json();
      setStatus(body.data.import.status);
      for (const doc of body.data.documents ?? []) {
        setUploadedDocs((current) => {
          const existing = current[doc.docType as DocumentType];
          if (existing && existing.version >= doc.version) return current;
          return {
            ...current,
            [doc.docType as DocumentType]: {
              id: doc.id,
              docType: doc.docType,
              filename: doc.originalFilename ?? "documento",
              version: doc.version,
            },
          };
        });
      }
      if (body.data.import.status === "awaiting_review") {
        await loadReport();
      }
    })();
  }, [importId, loadReport]);

  async function handleProcess() {
    setError(null);
    setProcessing(true);
    try {
      const response = await fetch(`/api/imports/${importId}/process`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Falha ao iniciar processamento");
      }
      setStatus("processing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{referenceNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {supplierName ?? "Fornecedor nao identificado"}
            {incoterm ? ` — ${incoterm}` : ""}
            {currency ? ` — ${currency}` : ""}
          </p>
        </div>
        <Badge variant={status === "processing" ? "warning" : "secondary"}>
          {STATUS_LABEL[status] ?? status}
        </Badge>
      </div>

      {(status === "uploaded" || status === "processing") && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Documentos</CardTitle>
            <CardDescription>
              Envie os tres documentos para habilitar a analise de IA
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              {REQUIRED_DOCS.map((docType) => (
                <DocumentUploadCard
                  key={docType}
                  importId={importId}
                  docType={docType}
                  disabled={status === "processing"}
                  onUploaded={(doc) =>
                    setUploadedDocs((current) => ({
                      ...current,
                      [doc.docType]: doc,
                    }))
                  }
                />
              ))}
            </div>

            {status === "processing" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                A IA esta analisando os documentos. Isso pode levar ate alguns
                minutos...
              </div>
            ) : (
              <Button
                onClick={handleProcess}
                disabled={!allDocsUploaded || processing}
                className="gap-2"
              >
                {processing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Iniciar analise de IA
              </Button>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      )}

      {status === "awaiting_review" && report ? (
        <ReviewReport
          importId={importId}
          report={report as never}
          onDecision={(newStatus) => setStatus(newStatus)}
        />
      ) : null}

      {status === "completed" && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-green-700">
              Importacao aprovada. Produtos cadastrados/atualizados no catalogo.
            </p>
          </CardContent>
        </Card>
      )}

      {status === "rejected" && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-destructive">
              Importacao rejeitada pelo usuario.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
