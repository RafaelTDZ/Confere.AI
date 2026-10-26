import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PaginationProps = {
  page: number;
  totalPages: number;
  pathname: string;
  searchParams?: Record<string, string | string[] | undefined>;
};

function buildHref(
  pathname: string,
  searchParams: PaginationProps["searchParams"],
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (key === "page" || key === "saved" || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else {
      params.set(key, value);
    }
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function Pagination({
  page,
  totalPages,
  pathname,
  searchParams,
}: PaginationProps) {
  const hasPrevious = page > 1;
  const hasNext = page < totalPages;
  const disabledClassName = cn(
    buttonVariants({ variant: "outline", size: "sm" }),
    "pointer-events-none text-muted-foreground opacity-50",
  );

  return (
    <nav
      aria-label="Paginação"
      className="flex flex-col items-center justify-between gap-2 sm:flex-row"
    >
      <span className="text-sm text-muted-foreground">
        Página {page} de {totalPages}
      </span>
      <div className="flex items-center gap-2">
        {hasPrevious ? (
          <Link
            href={buildHref(pathname, searchParams, page - 1)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Anterior
          </Link>
        ) : (
          <span className={disabledClassName}>Anterior</span>
        )}
        {hasNext ? (
          <Link
            href={buildHref(pathname, searchParams, page + 1)}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            Próxima
          </Link>
        ) : (
          <span className={disabledClassName}>Próxima</span>
        )}
      </div>
    </nav>
  );
}
