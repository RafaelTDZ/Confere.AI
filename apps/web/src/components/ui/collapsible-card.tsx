"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Card com cabeçalho clicável. Fechado por padrão: o conteúdo (e os campos do
 * formulário) só é montado quando aberto. Ações externas (ex.: "Rastrear") ficam
 * fora da área clicável e continuam visíveis com o card recolhido.
 */
export function CollapsibleCard({
  title,
  badge,
  description,
  defaultOpen = false,
  action,
  children,
  className,
  contentClassName,
}: {
  title: string;
  /** Elemento curto ao lado do título (ex.: badge com número do BL). */
  badge?: ReactNode;
  description?: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader
        className={cn(
          "flex flex-row items-center gap-2 p-0 transition-colors hover:bg-muted",
          open && "border-b bg-muted/50",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex flex-1 items-center gap-3 px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-180",
            )}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-base font-semibold leading-6">{title}</span>
              {badge ? (
                <span className="flex min-w-0 items-center">{badge}</span>
              ) : null}
            </span>
            {description ? (
              <span className="block text-sm text-muted-foreground">
                {description}
              </span>
            ) : null}
          </div>
        </button>
        {action ? (
          <div className="flex shrink-0 items-center py-4 pr-5">{action}</div>
        ) : null}
      </CardHeader>
      {open ? (
        <CardContent
          id={contentId}
          className={cn("pt-4", contentClassName)}
        >
          {children}
        </CardContent>
      ) : null}
    </Card>
  );
}
