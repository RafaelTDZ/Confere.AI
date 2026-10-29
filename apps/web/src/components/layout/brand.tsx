import Link from "next/link";
import { cn } from "@/lib/utils";

/** Símbolo da marca: quadrado azul de 20px com check branco. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 12 5 5 9-10" />
      </svg>
    </span>
  );
}

export function Brand({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <Link
      href="/analise"
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-md text-base font-semibold tracking-tight text-foreground",
        className,
      )}
    >
      <BrandMark />
      Confere AI
    </Link>
  );
}
