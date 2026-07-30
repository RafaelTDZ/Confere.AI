import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Clock, FileStack } from "lucide-react";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default async function DashboardPage() {
  const ctx = await getAuthContext().catch(() => null);
  if (!ctx) redirect("/login");

  const supabase = await createSupabaseServerClient();

  const [importsResult, productsResult] = await Promise.all([
    supabase
      .from("imports")
      .select("status", { count: "exact" })
      .eq("tenant_id", ctx.tenantId),
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId),
  ]);

  const imports = importsResult.data ?? [];
  const awaiting = imports.filter((i) => i.status === "awaiting_review").length;
  const processing = imports.filter((i) => i.status === "processing").length;
  const completed = imports.filter((i) => i.status === "completed").length;

  const stats = [
    {
      label: "Importacoes totais",
      value: importsResult.count ?? 0,
      icon: FileStack,
    },
    { label: "Aguardando revisao", value: awaiting, icon: AlertTriangle },
    { label: "Processando", value: processing, icon: Clock },
    { label: "Concluidas", value: completed, icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Visao geral das suas importacoes
          </p>
        </div>
        <Link
          href="/imports/new"
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
        >
          Nova importacao
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <CardTitle className="text-3xl">{stat.value}</CardTitle>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catalogo de produtos</CardTitle>
          <CardDescription>
            {productsResult.count ?? 0} produtos cadastrados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/products"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Ver catalogo completo
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
