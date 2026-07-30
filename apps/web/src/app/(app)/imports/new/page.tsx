import { NewImportForm } from "./new-import-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NewImportPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Nova importacao</h1>
        <p className="text-sm text-muted-foreground">
          Informe os dados basicos e envie Invoice, Packing List e BL
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dados da importacao</CardTitle>
          <CardDescription>
            A analise de IA inicia apos o envio dos tres documentos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewImportForm />
        </CardContent>
      </Card>
    </div>
  );
}
