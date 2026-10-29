import Link from "next/link";
import { BrandMark } from "@/components/layout/brand";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-4 text-center">
      <BrandMark className="size-8 rounded-md [&_svg]:size-4" />
      <p className="text-xs font-medium text-muted-foreground">Erro 404</p>
      <h1 className="text-2xl font-semibold tracking-tight">
        Página não encontrada
      </h1>
      <p className="max-w-[48ch] text-base text-muted-foreground">
        O endereço pode estar errado ou a página foi removida.
      </p>
      <Link href="/analise" className={buttonVariants()}>
        Ir para Nova análise
      </Link>
    </main>
  );
}
