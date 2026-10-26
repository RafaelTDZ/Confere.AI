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
  clearHref: string;
};

export function ListFilters({
  action,
  searchValue,
  searchPlaceholder = "Buscar",
  statusName = "status",
  statusValue,
  statusOptions,
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
          className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Todos</option>
          {statusOptions.map((option) => (
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
