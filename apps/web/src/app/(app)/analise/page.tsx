import {
  CheckCircle2,
  FileCheck2,
  FileText,
  FileUp,
  ListChecks,
  ScanSearch,
  Ship,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { UploadDropzone } from "@/components/analise/upload-dropzone";

const STEPS = [
  {
    icon: FileUp,
    title: "Envie os documentos",
    description:
      "Arraste os arquivos da importação. Aceitamos PDF e imagens.",
  },
  {
    icon: ScanSearch,
    title: "A IA classifica e extrai",
    description:
      "Identificamos o tipo de cada documento e extraímos os dados automaticamente.",
  },
  {
    icon: FileCheck2,
    title: "Revise e confirme",
    description:
      "Confira as divergências apontadas e aprove a análise com segurança.",
  },
] as const;

const REQUIRED_DOCS = [
  {
    icon: FileText,
    name: "Invoice",
    detail: "Fatura comercial do fornecedor",
    required: true,
  },
  {
    icon: Ship,
    name: "Bill of Lading (BL)",
    detail: "Conhecimento de embarque",
    required: true,
  },
  {
    icon: ListChecks,
    name: "Packing List",
    detail: "Lista de volumes e embalagem",
    required: false,
  },
] as const;

export default async function AnalisePage({
  searchParams,
}: {
  searchParams: Promise<{ partes?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      {params.partes === "ok" && (
        <p className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
          Consignee e notify cadastrados com sucesso.
        </p>
      )}
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs font-medium uppercase tracking-wide">
            Análise com IA
          </span>
        </div>
        <h1 className="text-balance text-2xl font-bold tracking-tight">
          Nova análise de importação
        </h1>
        <p className="max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
          Envie os documentos da sua importação e o Confere.ia classifica,
          extrai e confere as informações automaticamente.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_320px]">
        <UploadDropzone />

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Como funciona</CardTitle>
              <CardDescription>
                Três passos para uma análise completa
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <step.icon className="h-4 w-4" />
                      </span>
                      {index < STEPS.length - 1 && (
                        <span
                          aria-hidden
                          className="mt-1 w-px flex-1 bg-border"
                        />
                      )}
                    </div>
                    <div className="space-y-0.5 pb-1">
                      <p className="text-sm font-medium leading-tight">
                        {step.title}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {step.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Documentos</CardTitle>
              <CardDescription>
                O que enviar para iniciar a análise
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {REQUIRED_DOCS.map((doc) => (
                  <li key={doc.name} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <doc.icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">
                        {doc.name}
                        {!doc.required && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            (opcional)
                          </span>
                        )}
                      </p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {doc.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
