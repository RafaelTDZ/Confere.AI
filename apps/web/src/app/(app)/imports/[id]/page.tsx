import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ImportDetailClient } from "./import-detail-client";

export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getAuthContext().catch(() => null);
  if (!ctx) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const { data: importRecord } = await supabase
    .from("imports")
    .select(
      "id, reference_number, status, supplier_name, incoterm, currency, created_at",
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .single();

  if (!importRecord) notFound();

  return (
    <ImportDetailClient
      importId={id}
      initialStatus={importRecord.status}
      referenceNumber={importRecord.reference_number}
      supplierName={importRecord.supplier_name}
      incoterm={importRecord.incoterm}
      currency={importRecord.currency}
    />
  );
}
