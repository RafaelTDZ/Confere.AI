"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, CircleDashed, Loader2 } from "lucide-react";
import { UploadDropzone } from "@/components/analise/upload-dropzone";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  IMPORT_DOCUMENT_TYPES,
  IMPORT_STATUS_LABELS,
  displayImportReference,
  type ImportDetail,
} from "@/lib/documents/imports-shared";
import { cn, formatDate } from "@/lib/utils";

function displayBlValue(value: string | null | undefined): string {
  const next = value?.trim() ?? "";
  return next.length > 0 ? next : "—";
}

function displayBlList(values: string[] | null | undefined): string {
  const items = (values ?? []).map((value) => value.trim()).filter(Boolean);
  return items.length > 0 ? items.join(", ") : "—";
}

function BlField({
  id,
  label,
  value,
  className,
}: {
  id: string;
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} disabled />
    </div>
  );
}

function BlSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

export function ImportacaoForm({
  detail,
  canEdit,
}: {
  detail: ImportDetail;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [referenceNumber, setReferenceNumber] = useState(
    displayImportReference(detail),
  );
  const [supplierName, setSupplierName] = useState(detail.supplier_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const status = IMPORT_STATUS_LABELS[detail.status] ?? {
    label: detail.status,
    variant: "outline" as const,
  };
  const products = detail.invoice?.products ?? [];
  const presentTypes = new Set(detail.documents.map((doc) => doc.doc_type));

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/imports/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceNumber,
          supplierName,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        import?: { id: string };
      };
      if (!res.ok) {
        throw new Error(data.error || "Falha ao atualizar importação");
      }
      if (data.import?.id && data.import.id !== detail.id) {
        router.push(`/importacoes/${data.import.id}?merged=ok`);
      } else {
        router.push("/importacoes?saved=ok");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da importação</CardTitle>
          <CardDescription>
            {canEdit
              ? "A referência organiza Invoice, Packing List e BL da mesma operação."
              : "Seu perfil só permite visualizar esta importação."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="import-reference">Referência</Label>
            <Input
              id="import-reference"
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
              disabled={loading || !canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-invoice">Número da invoice</Label>
            <Input
              id="import-invoice"
              value={detail.invoice_number ?? ""}
              disabled
              placeholder="—"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-bl">Número do BL</Label>
            <Input
              id="import-bl"
              value={detail.bl_number ?? ""}
              disabled
              placeholder="—"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-supplier">Fornecedor</Label>
            <Input
              id="import-supplier"
              value={supplierName}
              onChange={(event) => setSupplierName(event.target.value)}
              disabled={loading || !canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <div className="flex h-9 items-center">
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Partes</CardTitle>
          <CardDescription>
            Consignee e notify vinculados a esta importação.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Consignee
            </p>
            {detail.consignee ? (
              <Link
                href={`/empresas/${detail.consignee.id}`}
                className="text-sm font-medium hover:underline"
              >
                {detail.consignee.name}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notify
            </p>
            {detail.notify ? (
              <Link
                href={`/empresas/${detail.notify.id}`}
                className="text-sm font-medium hover:underline"
              >
                {detail.notify.name}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documentos</CardTitle>
          <CardDescription>
            Invoice, BL e Packing List desta operação.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="flex flex-wrap gap-2">
            {IMPORT_DOCUMENT_TYPES.map((type) => {
              const present = presentTypes.has(type);
              return (
                <li
                  key={type}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
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
                  {DOCUMENT_TYPE_LABELS[type]}
                </li>
              );
            })}
          </ul>

          {canEdit ? (
            <UploadDropzone
              importId={detail.id}
              initialTypes={[...presentTypes]}
              embedded
            />
          ) : null}
        </CardContent>
        <div className="overflow-x-auto">
          {detail.documents.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Nenhum documento anexado.
            </p>
          ) : (
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Tipo</th>
                  <th className="px-6 py-3 font-medium">Arquivo</th>
                  <th className="px-6 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium">Enviado em</th>
                </tr>
              </thead>
              <tbody>
                {detail.documents.map((doc) => (
                  <tr key={doc.id} className="border-b last:border-0">
                    <td className="px-6 py-3 font-medium">
                      {DOCUMENT_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {doc.original_filename || "—"}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {DOCUMENT_STATUS_LABELS[doc.status] ?? doc.status}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {formatDate(doc.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados do BL</CardTitle>
          <CardDescription>
            Extração do Bill of Lading, quando houver.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {detail.bl ? (
            <>
              <BlSection title="Identificação">
                <BlField
                  id="bl-carrier"
                  label="Armador"
                  value={displayBlValue(detail.bl.carrier)}
                />
                <BlField
                  id="bl-vessel"
                  label="Navio"
                  value={displayBlValue(detail.bl.vessel)}
                />
                <BlField
                  id="bl-voyage"
                  label="Viagem"
                  value={displayBlValue(detail.bl.voyage)}
                />
                <BlField
                  id="bl-shipper"
                  label="Shipper"
                  value={displayBlValue(detail.bl.shipper)}
                />
                <BlField
                  id="bl-consignee-text"
                  label="Consignee (BL)"
                  value={displayBlValue(detail.bl.consignee)}
                />
                <BlField
                  id="bl-notify-text"
                  label="Notify (BL)"
                  value={displayBlValue(detail.bl.notifyParty)}
                  className="sm:col-span-2"
                />
              </BlSection>

              <BlSection title="Rotas e datas">
                <BlField
                  id="bl-pol-city"
                  label="Cidade de origem (POL)"
                  value={displayBlValue(detail.bl.polCity)}
                />
                <BlField
                  id="bl-pol-country"
                  label="País de origem (POL)"
                  value={displayBlValue(detail.bl.polCountry)}
                />
                <BlField
                  id="bl-pod-city"
                  label="Cidade de destino (POD)"
                  value={displayBlValue(detail.bl.podCity)}
                />
                <BlField
                  id="bl-pod-country"
                  label="País de destino (POD)"
                  value={displayBlValue(detail.bl.podCountry)}
                />
                <BlField
                  id="bl-onboard"
                  label="Data de embarque"
                  value={displayBlValue(detail.bl.onboardDate)}
                />
                <BlField
                  id="bl-eta"
                  label="ETA"
                  value={displayBlValue(detail.bl.eta)}
                />
              </BlSection>

              <BlSection title="Carga">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="bl-description">Descrição da mercadoria</Label>
                  <textarea
                    id="bl-description"
                    value={displayBlValue(detail.bl.descriptionOfGoods)}
                    disabled
                    rows={3}
                    className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
                <BlField
                  id="bl-gross-weight"
                  label="Peso bruto"
                  value={displayBlValue(detail.bl.grossWeight)}
                />
                <BlField
                  id="bl-volumes"
                  label="Volumes"
                  value={displayBlValue(detail.bl.volumes)}
                />
                <BlField
                  id="bl-packages"
                  label="Embalagem"
                  value={displayBlValue(detail.bl.packages)}
                />
                <BlField
                  id="bl-measurement"
                  label="Cubagem"
                  value={displayBlValue(detail.bl.measurement)}
                />
              </BlSection>

              <BlSection title="Frete">
                <BlField
                  id="bl-freight-value"
                  label="Valor do frete"
                  value={displayBlValue(detail.bl.freightValue)}
                />
                <BlField
                  id="bl-freight-currency"
                  label="Moeda"
                  value={displayBlValue(detail.bl.freightCurrency)}
                />
                <BlField
                  id="bl-freight-terms"
                  label="Termos"
                  value={displayBlValue(detail.bl.freightTerms)}
                />
                <BlField
                  id="bl-free-time"
                  label="Free time"
                  value={displayBlValue(detail.bl.freeTime)}
                />
              </BlSection>

              <BlSection title="Containers">
                <BlField
                  id="bl-container-numbers"
                  label="Números"
                  value={displayBlList(detail.bl.containerNumbers)}
                  className="sm:col-span-2"
                />
                <BlField
                  id="bl-container-quantity"
                  label="Quantidade"
                  value={displayBlValue(detail.bl.containerQuantity)}
                />
                <BlField
                  id="bl-container-type"
                  label="Tipo"
                  value={displayBlValue(detail.bl.containerType)}
                />
                <BlField
                  id="bl-seal-numbers"
                  label="Lacres"
                  value={displayBlList(detail.bl.sealNumbers)}
                  className="sm:col-span-2"
                />
              </BlSection>

              <BlSection title="NCM do BL">
                <BlField
                  id="bl-ncm"
                  label="Códigos"
                  value={displayBlList(detail.bl.ncm)}
                  className="sm:col-span-2"
                />
              </BlSection>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum dado de BL extraído ainda.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Produtos</CardTitle>
          <CardDescription>
            Linhas extraídas da Invoice, quando houver.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {products.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted-foreground">
              Nenhum produto extraído ainda.
            </p>
          ) : (
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-6 py-3 font-medium">Código</th>
                  <th className="px-6 py-3 font-medium">NCM</th>
                  <th className="px-6 py-3 font-medium">Descrição</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product, index) => (
                  <tr
                    key={`${product.code ?? "p"}-${index}`}
                    className="border-b last:border-0"
                  >
                    <td className="px-6 py-3 font-medium">
                      {product.code || "—"}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {product.ncm || "—"}
                    </td>
                    <td className="px-6 py-3 text-muted-foreground">
                      {product.description || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {error && (
        <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Link
          href="/importacoes"
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          Voltar
        </Link>
        {canEdit ? (
          <Button type="submit" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar"
            )}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
