"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BackButton({ fallbackHref }: { fallbackHref: string }) {
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
      className="-ml-2"
    >
      <ArrowLeft className="h-5 w-5" />
    </Button>
  );
}
