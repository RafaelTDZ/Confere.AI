import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** Cabeçalho único das páginas de lista: eyebrow opcional, título, descrição e ações. */
export function PageHeader({
  eyebrow,
  icon: Icon,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : null}
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="max-w-[60ch] text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
