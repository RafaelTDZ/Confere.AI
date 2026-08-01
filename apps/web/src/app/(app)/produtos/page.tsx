import { Boxes } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ProdutosPage() {
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-primary">
          <Boxes className="h-4 w-4" />
          Produtos
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Catálogo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gerencie os produtos do tenant para matching nas análises.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Catálogo em breve</CardTitle>
          <CardDescription>
            O CRUD de produtos e o match com itens extraídos da Invoice ainda
            não estão disponíveis nesta versão.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
