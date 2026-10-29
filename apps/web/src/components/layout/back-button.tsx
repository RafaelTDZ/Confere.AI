"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function BackButton({
  fallbackHref,
  className,
}: {
  fallbackHref: string;
  className?: string;
}) {
  const router = useRouter();

  function goBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Voltar para a página anterior"
      title="Voltar"
      onClick={goBack}
      className={cn("-ml-2", className)}
    >
      <ArrowLeft className="h-5 w-5" />
    </Button>
  );
}
