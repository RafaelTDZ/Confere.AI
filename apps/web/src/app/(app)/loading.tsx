export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto w-full max-w-7xl space-y-6"
    >
      <span className="sr-only">Carregando…</span>
      <div className="space-y-3" aria-hidden="true">
        <div className="h-4 w-28 animate-pulse rounded-sm bg-muted" />
        <div className="h-7 w-72 animate-pulse rounded-sm bg-muted" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded-sm bg-muted" />
      </div>
      <div className="h-9 w-full max-w-md animate-pulse rounded-md bg-muted" aria-hidden="true" />
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-lg border border-border bg-card"
      >
        <div className="h-8 bg-muted" />
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="flex h-10 items-center gap-4 border-b border-border px-4 last:border-0"
          >
            <div className="h-3.5 w-1/5 animate-pulse rounded-sm bg-muted" />
            <div className="h-3.5 w-1/6 animate-pulse rounded-sm bg-muted" />
            <div className="h-3.5 w-1/6 animate-pulse rounded-sm bg-muted" />
            <div className="h-3.5 w-20 animate-pulse rounded-sm bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
