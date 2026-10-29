"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, FileText, Receipt, ScrollText, Ship, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CollapsibleCard } from "@/components/ui/collapsible-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  BlExtraction,
  DocumentType,
  InvoiceExtraction,
} from "@/lib/ai/schemas";
import {
  BL_DATE_FIELDS,
  BL_EDITABLE_LIST_FIELDS,
  BL_EDITABLE_TEXT_FIELDS,
  formatDateBr,
  type BlEditableListField,
  type BlEditableTextField,
} from "@/lib/documents/import-edit-shared";
import {
  DOCUMENT_STATUS_LABELS,
  DOCUMENT_TYPE_LABELS,
  IMPORT_DOCUMENT_TYPES,
  IMPORT_STATUS_LABELS,
  displayImportReference,
  type ImportDetail,
  type ImportPartySummary,
} from "@/lib/documents/imports-shared";
import { setFlash } from "@/lib/flash";
import { cn, formatDate } from "@/lib/utils";

type BlFormState = {
  text: Record<BlEditableTextField, string>;
  lists: Record<BlEditableListField, string>;
};

type ProductFormRow = {
  code: string;
  ncm: string;
  description: string;
};

const FIELD_INPUT = "h-11 sm:h-9";
const FIELD_TEXTAREA =
  "flex min-h-20 w-full rounded-md border border-input bg-card px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground md:text-sm";
const CELL_INPUT =
  "h-11 border-transparent bg-transparent px-2 shadow-none hover:border-input focus-visible:bg-card disabled:border-transparent disabled:bg-transparent disabled:text-foreground sm:h-9";
const TABLE_EDGE = "first:pl-5 last:pr-5";

const DOCUMENT_TYPE_ICONS: Partial<Record<DocumentType, LucideIcon>> = {
  invoice: Receipt,
  packing_list: Boxes,
  bill_of_lading: ScrollText,
};

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildBlFormState(bl: BlExtraction | null): BlFormState {
  const text = {} as Record<BlEditableTextField, string>;
  for (const field of BL_EDITABLE_TEXT_FIELDS) {
    text[field] = bl?.[field] ?? "";
  }
  for (const field of BL_DATE_FIELDS) {
    text[field] = formatDateBr(text[field]);
  }
  const lists = {} as Record<BlEditableListField, string>;
  for (const field of BL_EDITABLE_LIST_FIELDS) {
    lists[field] = (bl?.[field] ?? []).join(", ");
  }
  return { text, lists };
}

function buildProductRows(
  products: NonNullable<InvoiceExtraction["products"]>,
): ProductFormRow[] {
  return products.map((product) => ({
    code: product.code ?? "",
    ncm: product.ncm ?? "",
    description: product.description ?? "",
  }));
}

function BlField({
  id,
  label,
  value,
  onChange,
  disabled,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className={FIELD_INPUT}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
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
    <div className="space-y-4">
      <p className="border-b border-border pb-2 text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">
        {title}
      </p>
      <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

/** Parte vinculada à importação, só leitura (notify), com a mesma moldura dos campos. */
function PartyValue({
  label,
  party,
}: {
  label: string;
  party: ImportPartySummary | null;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium leading-5">{label}</p>
      <div className="flex min-h-9 items-center rounded-md border border-border bg-muted px-3 py-1.5 text-sm">
        {party ? (
          <Link
            href={`/empresas/${party.id}`}
            className="break-words font-medium text-primary-text underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {party.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
    </div>
  );
}

export function ImportacaoForm({
  detail,
  canEdit,
  trackingHref,
}: {
  detail: ImportDetail;
  canEdit: boolean;
  trackingHref: string;
}) {
  const router = useRouter();
  const [referenceNumber, setReferenceNumber] = useState(
    displayImportReference(detail),
  );
  const [bl, setBl] = useState<BlFormState>(() => buildBlFormState(detail.bl));
  const [products, setProducts] = useState<ProductFormRow[]>(() =>
    buildProductRows(detail.invoice?.products ?? []),
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const presentTypes = new Set(detail.documents.map((doc) => doc.doc_type));
  const hasInvoice = presentTypes.has("invoice") || detail.invoice !== null;
  const hasBl = presentTypes.has("bill_of_lading") || detail.bl !== null;
  const fieldsDisabled = loading || !canEdit;

  const status = IMPORT_STATUS_LABELS[detail.status] ?? {
    label: detail.status,
    variant: "outline" as const,
  };

  function updateBlText(field: BlEditableTextField, value: string) {
    setBl((previous) => ({
      ...previous,
      text: { ...previous.text, [field]: value },
    }));
  }

  function updateBlList(field: BlEditableListField, value: string) {
    setBl((previous) => ({
      ...previous,
      lists: { ...previous.lists, [field]: value },
    }));
  }

  function updateProduct(
    index: number,
    field: keyof ProductFormRow,
    value: string,
  ) {
    setProducts((previous) =>
      previous.map((product, position) =>
        position === index ? { ...product, [field]: value } : product,
      ),
    );
  }

  function buildBlPayload() {
    if (!detail.bl) return undefined;
    const text = { ...bl.text };
    for (const field of BL_DATE_FIELDS) {
      text[field] = formatDateBr(text[field]);
    }
    return {
      ...Object.fromEntries(
        BL_EDITABLE_TEXT_FIELDS.map((field) => [
          field,
          text[field].trim() || null,
        ]),
      ),
      ...Object.fromEntries(
        BL_EDITABLE_LIST_FIELDS.map((field) => [
          field,
          splitList(bl.lists[field]),
        ]),
      ),
    };
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canEdit) return;
    setError(null);
    setLoading(true);

    const blPayload = buildBlPayload();

    try {
      const res = await fetch(`/api/imports/${detail.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referenceNumber,
          ...(blPayload ? { bl: blPayload } : {}),
          ...(detail.invoice
            ? {
                products: products.map((product) => ({
                  code: product.code.trim() || null,
                  ncm: product.ncm.trim() || null,
                  description: product.description.trim() || null,
                })),
              }
            : {}),
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
        setFlash("Importação atualizada com sucesso.");
        router.push("/importacoes");
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
      {canEdit ? null : (
        <Notice tone="info">
          Seu perfil só permite visualizar esta importação.
        </Notice>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da Importação</CardTitle>
          <CardDescription>
            Referência, datas e partes da importação.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="import-reference">Referência</Label>
            <Input
              id="import-reference"
              className={FIELD_INPUT}
              value={referenceNumber}
              onChange={(event) => setReferenceNumber(event.target.value)}
              disabled={loading || !canEdit}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-eta">Previsão de chegada (ETA)</Label>
            <Input
              id="import-eta"
              className={FIELD_INPUT}
              value={bl.text.eta}
              onChange={(event) => updateBlText("eta", event.target.value)}
              disabled={!detail.bl || fieldsDisabled}
              placeholder="DD/MM/AAAA"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="import-ets">Data de embarque (ETS)</Label>
            <Input
              id="import-ets"
              className={FIELD_INPUT}
              value={bl.text.onboardDate}
              onChange={(event) =>
                updateBlText("onboardDate", event.target.value)
              }
              disabled={!detail.bl || fieldsDisabled}
              placeholder="DD/MM/AAAA"
            />
          </div>
          <PartyValue label="Consignee" party={detail.consignee} />
          <PartyValue label="Notify" party={detail.notify} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Documentos</CardTitle>
            <Badge variant="secondary">{detail.documents.length}</Badge>
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="Tipos de documento">
            {IMPORT_DOCUMENT_TYPES.map((type) => {
              const present = presentTypes.has(type);
              return (
                <li key={type}>
                  <Badge variant={present ? "success" : "outline"}>
                    {DOCUMENT_TYPE_LABELS[type]}
                    {present ? null : (
                      <span className="sr-only"> (ausente)</span>
                    )}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </CardHeader>
        <CardContent className="p-0">
          {detail.documents.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              Nenhum documento anexado.
            </p>
          ) : (
            <Table aria-label="Documentos da importação">
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_EDGE}>Tipo</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className={cn("text-right", TABLE_EDGE)}>
                    Enviado em
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.documents.map((doc) => {
                  const DocIcon = DOCUMENT_TYPE_ICONS[doc.doc_type] ?? FileText;
                  return (
                    <TableRow key={doc.id}>
                      <TableCell className={cn("font-medium", TABLE_EDGE)}>
                        <span className="flex items-center gap-2">
                          <DocIcon
                            aria-hidden="true"
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                          />
                          {DOCUMENT_TYPE_LABELS[doc.doc_type] ?? doc.doc_type}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span
                          className="block max-w-[32ch] truncate"
                          title={doc.original_filename ?? undefined}
                        >
                          {doc.original_filename || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={status.variant}
                          title={`Documento: ${
                            DOCUMENT_STATUS_LABELS[doc.status] ?? doc.status
                          }`}
                        >
                          <span className="sr-only">
                            Status da importação:{" "}
                          </span>
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          "whitespace-nowrap text-right tabular-nums text-muted-foreground",
                          TABLE_EDGE,
                        )}
                      >
                        {formatDate(doc.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {hasBl || detail.bl_number ? (
        <CollapsibleCard
          title="Dados do BL"
          badge={
            detail.bl_number ? (
              <Badge
                variant="success"
                className="max-w-[24ch] font-mono tabular-nums"
                title={`BL ${detail.bl_number}`}
              >
                <span className="truncate">{detail.bl_number}</span>
              </Badge>
            ) : null
          }
          description="Campos extraídos do conhecimento de embarque."
          action={
            <Link
              href={trackingHref}
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "min-h-11 shrink-0 sm:min-h-8",
              )}
            >
              <Ship aria-hidden="true" className="h-4 w-4" />
              Rastrear
            </Link>
          }
          contentClassName="space-y-6"
        >
          {detail.bl ? (
            <>
              <BlSection title="Identificação">
                <BlField
                  id="bl-carrier"
                  label="Armador"
                  value={bl.text.carrier}
                  onChange={(value) => updateBlText("carrier", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-vessel"
                  label="Navio"
                  value={bl.text.vessel}
                  onChange={(value) => updateBlText("vessel", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-voyage"
                  label="Viagem"
                  value={bl.text.voyage}
                  onChange={(value) => updateBlText("voyage", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-master-number"
                  label="BL master (MBL)"
                  value={bl.text.masterBlNumber}
                  onChange={(value) => updateBlText("masterBlNumber", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-shipper"
                  label="Shipper"
                  value={bl.text.shipper}
                  onChange={(value) => updateBlText("shipper", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-consignee-text"
                  label="Consignee (BL)"
                  value={bl.text.consignee}
                  onChange={(value) => updateBlText("consignee", value)}
                  className="sm:col-span-2"
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-notify-text"
                  label="Notify (BL)"
                  value={bl.text.notifyParty}
                  onChange={(value) => updateBlText("notifyParty", value)}
                  className="sm:col-span-2"
                  disabled={fieldsDisabled}
                />
              </BlSection>

              <BlSection title="Rotas e datas">
                <BlField
                  id="bl-pol-city"
                  label="Cidade de origem (POL)"
                  value={bl.text.polCity}
                  onChange={(value) => updateBlText("polCity", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-pol-country"
                  label="País de origem (POL)"
                  value={bl.text.polCountry}
                  onChange={(value) => updateBlText("polCountry", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-pod-city"
                  label="Cidade de destino (POD)"
                  value={bl.text.podCity}
                  onChange={(value) => updateBlText("podCity", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-pod-country"
                  label="País de destino (POD)"
                  value={bl.text.podCountry}
                  onChange={(value) => updateBlText("podCountry", value)}
                  disabled={fieldsDisabled}
                />
              </BlSection>

              <BlSection title="Carga">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="bl-description">
                    Descrição da mercadoria
                  </Label>
                  <textarea
                    id="bl-description"
                    value={bl.text.descriptionOfGoods}
                    disabled={fieldsDisabled}
                    rows={3}
                    onChange={(event) =>
                      updateBlText("descriptionOfGoods", event.target.value)
                    }
                    className={FIELD_TEXTAREA}
                  />
                </div>
                <BlField
                  id="bl-gross-weight"
                  label="Peso bruto"
                  value={bl.text.grossWeight}
                  onChange={(value) => updateBlText("grossWeight", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-volumes"
                  label="Volumes"
                  value={bl.text.volumes}
                  onChange={(value) => updateBlText("volumes", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-packages"
                  label="Embalagem"
                  value={bl.text.packages}
                  onChange={(value) => updateBlText("packages", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-measurement"
                  label="Cubagem"
                  value={bl.text.measurement}
                  onChange={(value) => updateBlText("measurement", value)}
                  disabled={fieldsDisabled}
                />
              </BlSection>

              <BlSection title="Frete">
                <BlField
                  id="bl-freight-value"
                  label="Valor do frete"
                  value={bl.text.freightValue}
                  onChange={(value) => updateBlText("freightValue", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-freight-currency"
                  label="Moeda"
                  value={bl.text.freightCurrency}
                  onChange={(value) => updateBlText("freightCurrency", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-freight-terms"
                  label="Termos"
                  value={bl.text.freightTerms}
                  onChange={(value) => updateBlText("freightTerms", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-free-time"
                  label="Free time"
                  value={bl.text.freeTime}
                  onChange={(value) => updateBlText("freeTime", value)}
                  disabled={fieldsDisabled}
                />
              </BlSection>

              <BlSection title="Containers">
                <BlField
                  id="bl-container-numbers"
                  label="Números"
                  value={bl.lists.containerNumbers}
                  onChange={(value) =>
                    updateBlList("containerNumbers", value)
                  }
                  className="sm:col-span-2"
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-container-quantity"
                  label="Quantidade"
                  value={bl.text.containerQuantity}
                  onChange={(value) =>
                    updateBlText("containerQuantity", value)
                  }
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-container-type"
                  label="Tipo"
                  value={bl.text.containerType}
                  onChange={(value) => updateBlText("containerType", value)}
                  disabled={fieldsDisabled}
                />
                <BlField
                  id="bl-seal-numbers"
                  label="Lacres"
                  value={bl.lists.sealNumbers}
                  onChange={(value) => updateBlList("sealNumbers", value)}
                  className="sm:col-span-2"
                  disabled={fieldsDisabled}
                />
              </BlSection>

              <BlSection title="NCM do BL">
                <BlField
                  id="bl-ncm"
                  label="Códigos"
                  value={bl.lists.ncm}
                  onChange={(value) => updateBlList("ncm", value)}
                  className="sm:col-span-2"
                  disabled={fieldsDisabled}
                />
              </BlSection>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhum dado de BL extraído ainda.
            </p>
          )}
        </CollapsibleCard>
      ) : null}

      {hasInvoice || detail.invoice_number ? (
        <CollapsibleCard
          title="Produtos"
          badge={
            detail.invoice_number ? (
              <Badge
                variant="success"
                className="max-w-[24ch] font-mono tabular-nums"
                title={`Invoice ${detail.invoice_number}`}
              >
                <span className="truncate">{detail.invoice_number}</span>
              </Badge>
            ) : null
          }
          description="Campos extraídos da Invoice e Packing List."
          contentClassName="p-0"
        >
          {products.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              Nenhum produto extraído ainda.
            </p>
          ) : (
            <Table aria-label="Produtos da invoice">
              <TableHeader>
                <TableRow>
                  <TableHead className={TABLE_EDGE}>Código</TableHead>
                  <TableHead>NCM</TableHead>
                  <TableHead className={TABLE_EDGE}>Descrição</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product, index) => (
                  <TableRow key={`${product.code ?? "p"}-${index}`}>
                    <TableCell className={TABLE_EDGE}>
                      <Input
                        aria-label={`Código do produto ${index + 1}`}
                        value={product.code ?? ""}
                        disabled={fieldsDisabled}
                        onChange={(event) =>
                          updateProduct(index, "code", event.target.value)
                        }
                        className={CELL_INPUT}
                        placeholder="—"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`NCM do produto ${index + 1}`}
                        value={product.ncm ?? ""}
                        disabled={fieldsDisabled}
                        onChange={(event) =>
                          updateProduct(index, "ncm", event.target.value)
                        }
                        className={CELL_INPUT}
                        placeholder="—"
                      />
                    </TableCell>
                    <TableCell className={TABLE_EDGE}>
                      <Input
                        aria-label={`Descrição do produto ${index + 1}`}
                        value={product.description ?? ""}
                        disabled={fieldsDisabled}
                        onChange={(event) =>
                          updateProduct(
                            index,
                            "description",
                            event.target.value,
                          )
                        }
                        className={CELL_INPUT}
                        placeholder="—"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CollapsibleCard>
      ) : null}

      <div className="sticky bottom-3 z-10 ml-auto w-fit max-w-full space-y-2 rounded-lg border border-border bg-card/95 p-2 shadow-sm backdrop-blur">
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : null}
        <div className="flex justify-end gap-2">
          <Link
            href="/importacoes"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-11 sm:h-9",
            )}
          >
            Voltar
          </Link>
          {canEdit ? (
            <Button type="submit" loading={loading} className="h-11 sm:h-9">
              Salvar alterações
            </Button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
