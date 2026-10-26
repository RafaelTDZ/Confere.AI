-- AI-01: fila de análise assíncrona.
--
-- O upload responde 202 com um job; o processamento roda em background e o
-- cliente acompanha por `GET /api/ai/jobs/:id`. O worker pode ser disparado
-- pelo `after()` da request ou pelo endpoint de retry/cron, sempre com claim
-- atômico (UPDATE ... RETURNING), então dois workers não pegam o mesmo job.
--
-- Arquivo bruto do upload fica no bucket `import-documents` em
-- `<tenant>/_jobs/<jobId>/<arquivo>` e é removido quando o job conclui.

create table if not exists public.ai_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  import_id uuid references public.imports (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed')),
  storage_path text not null,
  file_name text not null,
  media_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  attempts integer not null default 0,
  error_message text,
  result jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists ai_jobs_tenant_created_idx
  on public.ai_jobs (tenant_id, created_at desc);

create index if not exists ai_jobs_queue_idx
  on public.ai_jobs (created_at)
  where status = 'queued';

alter table public.ai_jobs enable row level security;

drop policy if exists ai_jobs_select on public.ai_jobs;
create policy ai_jobs_select
  on public.ai_jobs
  for select
  to authenticated
  using (tenant_id = private.current_tenant_id());

-- Claim atômico de um job específico (disparo via after()).
create or replace function public.claim_ai_job(p_job_id uuid)
returns public.ai_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.ai_jobs%rowtype;
begin
  update public.ai_jobs
  set
    status = 'running',
    started_at = now(),
    attempts = attempts + 1,
    error_message = null
  where id = p_job_id and status = 'queued'
  returning * into v_job;

  return v_job;
end;
$$;

-- Claim do próximo job da fila, incluindo jobs travados em `running` há mais
-- de `p_stale_seconds` (retry após worker morto). Limita as tentativas.
create or replace function public.claim_next_ai_job(
  p_stale_seconds integer default 900,
  p_max_attempts integer default 3
) returns public.ai_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.ai_jobs%rowtype;
begin
  update public.ai_jobs as j
  set
    status = 'running',
    started_at = now(),
    attempts = j.attempts + 1,
    error_message = null
  where j.id = (
    select id
    from public.ai_jobs
    where attempts < p_max_attempts
      and (
        status = 'queued'
        or (
          status = 'running'
          and started_at < now() - make_interval(secs => p_stale_seconds)
        )
      )
    order by created_at
    limit 1
    for update skip locked
  )
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.claim_ai_job(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_next_ai_job(integer, integer)
  from public, anon, authenticated;

grant execute on function public.claim_ai_job(uuid) to service_role;
grant execute on function public.claim_next_ai_job(integer, integer)
  to service_role;

notify pgrst, 'reload schema';
