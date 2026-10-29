import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type FilterOption = { value: string; label: string };

export type ListFiltersProps = {
  action: string;
  searchValue?: string;
  searchPlaceholder?: string;
  /** Nome do campo de status no formulário (padrão: "status"). */
  statusName?: string;
  statusValue?: string;
  statusOptions?: FilterOption[];
  /** Ordenação (campo `sort`); sem opções, o select não é renderizado. */
  sortLabel?: string;
  sortValue?: string;
  sortOptions?: FilterOption[];
  clearHref: string;
};

const SELECT_CLASS_NAME =
  "h-9 rounded-md border border-input bg-card px-3 py-1 text-sm text-foreground transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ListFilters({
  action,
  searchValue,
  searchPlaceholder = "Buscar",
  statusName = "status",
  statusValue,
  statusOptions,
  sortLabel = "Ordenar por",
  sortValue,
  sortOptions,
  clearHref,
}: ListFiltersProps) {
  return (
    <form
      method="get"
      action={action}
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <Input
        name="q"
        defaultValue={searchValue}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        className="sm:max-w-xs"
      />
      {statusOptions && statusOptions.length > 0 && (
        <select
          name={statusName}
          defaultValue={statusValue ?? ""}
          aria-label="Filtrar por status"
          className={SELECT_CLASS_NAME}
        >
          <option value="">Todos</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      {sortOptions && sortOptions.length > 0 && (
        <select
          name="sort"
          defaultValue={sortValue ?? sortOptions[0]?.value}
          aria-label={sortLabel}
          className={SELECT_CLASS_NAME}
        >
          {sortOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm">
          Filtrar
        </Button>
        <Link
          href={clearHref}
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
        >
          Limpar
        </Link>
      </div>
    </form>
  );
}
