-- Custo e reasoning por chamada de IA; vínculo com importação para agregação futura.
alter table public.ai_logs
  add column if not exists cost_usd numeric(12, 8),
  add column if not exists reasoning_tokens integer not null default 0,
  add column if not exists import_id uuid references public.imports (id) on delete set null;

create index if not exists ai_logs_import_idx
  on public.ai_logs (import_id)
  where import_id is not null;
