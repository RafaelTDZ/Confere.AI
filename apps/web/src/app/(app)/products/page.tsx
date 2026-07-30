import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await getAuthContext().catch(() => null);
  if (!ctx) redirect("/onboarding");

  const { q } = await searchParams;
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("products")
    .select("id, sku, description, ncm, unit_of_measure, unit_weight, origin")
    .eq("tenant_id", ctx.tenantId)
    .order("sku")
    .limit(100);

  if (q) {
    query = query.ilike("description", `%${q}%`);
  }

  const { data: products } = await query;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Produtos</h1>
        <p className="text-sm text-muted-foreground">
          Catalogo do tenant — alimentado manualmente e pela IA
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalogo</CardTitle>
          <CardDescription>
            {products?.length ?? 0} produtos
            {q ? ` — filtrando por "${q}"` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!products || products.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum produto cadastrado. Produtos sao criados automaticamente
              apos a aprovacao de uma importacao.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4">SKU</th>
                    <th className="py-2 pr-4">Descricao</th>
                    <th className="py-2 pr-4">NCM</th>
                    <th className="py-2 pr-4">Peso un.</th>
                    <th className="py-2 pr-4">Un.</th>
                    <th className="py-2">Origem</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td className="py-2 pr-4 font-medium">{product.sku}</td>
                      <td className="py-2 pr-4">{product.description}</td>
                      <td className="py-2 pr-4">{product.ncm ?? "-"}</td>
                      <td className="py-2 pr-4">
                        {product.unit_weight != null
                          ? `${Number(product.unit_weight).toFixed(3)} kg`
                          : "-"}
                      </td>
                      <td className="py-2 pr-4">
                        {product.unit_of_measure ?? "-"}
                      </td>
                      <td className="py-2">
                        <Badge
                          variant={
                            product.origin === "ai" ? "default" : "secondary"
                          }
                        >
                          {product.origin === "ai" ? "IA" : "Manual"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
