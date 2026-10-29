import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Tinta + ponto + texto (nunca texto branco sobre cor sólida). `default` é o
 * azul de ação/progresso; `warning` pede atenção; `destructive` é problema.
 */
const badgeVariants = cva(
  "inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-sm px-2 text-xs font-medium before:size-1.5 before:shrink-0 before:rounded-full",
  {
    variants: {
      variant: {
        default: "bg-primary-soft text-primary-text before:bg-primary",
        secondary:
          "bg-secondary text-secondary-foreground before:bg-muted-foreground",
        outline:
          "border border-border bg-card text-secondary-foreground before:bg-muted-foreground",
        success: "bg-success-soft text-success-text before:bg-success",
        warning: "bg-warning-soft text-warning-text before:bg-warning",
        destructive:
          "bg-destructive-soft text-destructive-text before:bg-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge };
