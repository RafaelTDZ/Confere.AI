"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import type {
  AnalysisResult,
  FieldDifference,
  Import,
  ProductMatch,
} from "@confere/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface ImportReport {
  import: Import;
  analyses: AnalysisResult[];
  matches: ProductMatch[];
}

type Action = "create" | "update" | "ignore";

const SEVERITY_ICON = {
  critical: <XCircle className="h-4 w-4 text-destructive" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-500" />,
  info: <Info className="h-4 w-4 text-blue-500" />,
} as const;

const MATCH_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }> = {
  new: { label: "Produto novo", variant: "default" },
  existing_match: { label: "Cadastro existente", variant: "success" },
  divergent: { label: "Divergente", variant: "warning" },
};

export function ReviewReport({
  importId,
  report,
  onDecision,
}: {
  importId: string;
  report: ImportReport;
  onDecision: (newStatus: string) => void;
}) {
  const findings = useMemo(
    () => report.analyses.flatMap((a) => a.findings),
    [report.analyses],
  );

  const [actions, setActions] = useState<Record<string, Action>>(() => {
    const initial: Record<string, Action> = {};
    for (const match of report.matches) {
      initial[match.id] =
        match.matchStatus === "new"
          ? "create"
          : match.matchStatus === "divergent"
            ? "update"
            : "ignore";
    }
    return initial;
  });
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setError(null);
    setSubmitting("approve");
    try {
      const decisions = Object.entries(actions).map(([matchId, action]) => ({
        matchId,
        action,
      }));
      const response = await fetch(`/api/imports/${importId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Falha ao aprovar");
      }
      onDecision("completed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleReject() {
    const reason = window.prompt("Motivo da rejeicao:");
    if (!reason) return;
    setError(null);
    setSubmitting("reject");
    try {
      const response = await fetch(`/api/imports/${importId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Falha ao rejeitar");
      }
      onDecision("rejected");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Divergencias entre documentos
          </CardTitle>
          <CardDescription>
            {findings.length === 0
              ? "Nenhuma divergencia encontrada entre Invoice, Packing List e BL"
              : `${findings.length} ponto(s) de atencao identificados pela IA`}
          </CardDescription>
        </CardHeader>
        {findings.length > 0 && (
          <CardContent>
            <ul className="space-y-3">
              {findings.map((finding, index) => (
                <li key={index} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5">
                    {SEVERITY_ICON[finding.severity]}
                  </span>
                  <div>
                    <p>{finding.message}</p>
                    {finding.suggestion && (
                      <p className="text-xs text-muted-foreground">
                        Sugestao: {finding.suggestion}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produtos identificados</CardTitle>
          <CardDescription>
            Revise cada item: cadastrar novo, atualizar existente ou ignorar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-4">
            {report.matches.map((match) => {
              const meta = MATCH_LABEL[match.matchStatus] ?? {
                label: match.matchStatus,
                variant: "secondary" as const,
              };
              return (
                <li key={match.id} className="rounded-md border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">
                        {match.extractedData.sku} —{" "}
                        {match.extractedData.description}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Qtd: {match.extractedData.quantity}{" "}
                        {match.extractedData.unitOfMeasure ?? ""}
                        {match.extractedData.ncm
                          ? ` — NCM ${match.extractedData.ncm}`
                          : ""}
                      </p>
                      {match.differences.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {match.differences.map(
                            (diff: FieldDifference, i: number) => (
                              <li
                                key={i}
                                className="text-xs text-amber-600"
                              >
                                {diff.field}: cadastro «{diff.catalogValue}» vs
                                documento «{diff.extractedValue}»
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </div>
                    <Badge variant={meta.variant}>{meta.label}</Badge>
                  </div>
                  <div className="mt-3 flex gap-2">
                    {(
                      [
                        ["create", "Cadastrar novo"],
                        ["update", "Atualizar cadastro"],
                        ["ignore", "Ignorar"],
                      ] as Array<[Action, string]>
                    ).map(([action, label]) => (
                      <Button
                        key={action}
                        type="button"
                        size="sm"
                        variant={
                          actions[match.id] === action ? "default" : "outline"
                        }
                        disabled={
                          action === "update" &&
                          match.matchStatus === "new"
                        }
                        onClick={() =>
                          setActions((current) => ({
                            ...current,
                            [match.id]: action,
                          }))
                        }
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex gap-3">
        <Button
          onClick={handleApprove}
          disabled={submitting !== null}
          className="gap-2"
        >
          {submitting === "approve" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Aprovar e atualizar catalogo
        </Button>
        <Button
          variant="destructive"
          onClick={handleReject}
          disabled={submitting !== null}
        >
          {submitting === "reject" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          Rejeitar importacao
        </Button>
      </div>
    </div>
  );
}
