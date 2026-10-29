-- ============================================================================
-- Rastreio de BL/container (Maersk, MSC, CMA CGM, Hapag-Lloyd, COSCO)
-- Leitura por tenant (RLS) e escrita apenas via service role (pipeline/cron).
-- ============================================================================

create table if not exists public.tracking_shipments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  import_id uuid not null references public.imports (id) on delete cascade,
  carrier_code text not null,
  strategy text not null default 'firecrawl'
    check (strategy in ('http', 'firecrawl', 'link', 'manual')),
  query_type text not null check (query_type in ('bl', 'container', 'booking')),
  query_value text not null,
  container_number text,
  status text not null default 'pending'
    check (status in (
      'pending',
      'in_transit',
      'transshipment',
      'arrived',
      'discharged',
      'delivered',
      'empty_returned',
      'not_found',
      'blocked',
      'error'
    )),
  vessel text,
  voyage text,
  eta date,
  last_event_at timestamptz,
  last_event_location text,
  last_event_description text,
  source text not null default 'scrape'
    check (source in ('scrape', 'manual')),
  fetched_at timestamptz,
  next_check_at timestamptz,
  attempts integer not null default 0,
  locked_until timestamptz,
  last_http_status integer,
  error_code text,
  error_message text,
  snapshot_path text,
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracking_shipments_target_key
    unique (import_id, carrier_code, query_type, query_value)
);

create table if not exists public.tracking_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  shipment_id uuid not null
    references public.tracking_shipments (id) on delete cascade,
  event_at timestamptz not null,
  status text not null,
  location text,
  description text,
  vessel text,
  voyage text,
  container_number text,
  source text not null default 'scrape'
    check (source in ('scrape', 'manual')),
  fingerprint text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tracking_events_fingerprint_key unique (shipment_id, fingerprint)
);

create table if not exists public.tracking_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  shipment_id uuid not null
    references public.tracking_shipments (id) on delete cascade,
  strategy text not null check (strategy in ('http', 'firecrawl')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  run_after timestamptz not null default now(),
  attempts integer not null default 0,
  locked_until timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tracking_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  period text not null,
  credits_used integer not null default 0,
  scrapes integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, period)
);

-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------

create index if not exists tracking_shipments_import_idx
  on public.tracking_shipments (import_id);
create index if not exists tracking_shipments_next_check_idx
  on public.tracking_shipments (next_check_at)
  where next_check_at is not null;
create index if not exists tracking_shipments_tenant_idx
  on public.tracking_shipments (tenant_id, created_at desc);
create index if not exists tracking_events_shipment_idx
  on public.tracking_events (shipment_id, event_at desc);
create index if not exists tracking_jobs_status_idx
  on public.tracking_jobs (status, run_after);
create index if not exists tracking_jobs_shipment_idx
  on public.tracking_jobs (shipment_id);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

drop trigger if exists tracking_shipments_touch on public.tracking_shipments;
create trigger tracking_shipments_touch
  before update on public.tracking_shipments
  for each row execute function private.touch_updated_at();

drop trigger if exists tracking_jobs_touch on public.tracking_jobs;
create trigger tracking_jobs_touch
  before update on public.tracking_jobs
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Orçamento de créditos (Firecrawl) por tenant/mês
-- Retorna false quando o teto seria ultrapassado (nada é gravado).
-- ---------------------------------------------------------------------------

create or replace function public.consume_tracking_credits(
  p_tenant_id uuid,
  p_period text,
  p_credits integer,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used integer;
begin
  if p_credits < 0 then
    raise exception 'p_credits deve ser >= 0';
  end if;

  if p_limit > 0 then
    select credits_used into v_used
    from public.tracking_usage
    where tenant_id = p_tenant_id and period = p_period
    for update;

    if coalesce(v_used, 0) + p_credits > p_limit then
      return false;
    end if;
  end if;

  insert into public.tracking_usage (tenant_id, period, credits_used, scrapes)
  values (p_tenant_id, p_period, p_credits, case when p_credits > 0 then 1 else 0 end)
  on conflict (tenant_id, period) do update
  set credits_used = public.tracking_usage.credits_used + excluded.credits_used,
      scrapes = public.tracking_usage.scrapes + excluded.scrapes,
      updated_at = now();

  return true;
end;
$$;

revoke all on function public.consume_tracking_credits(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_tracking_credits(uuid, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Claim de jobs (cron/web usa service role)
-- ---------------------------------------------------------------------------

create or replace function public.claim_tracking_jobs(
  p_worker text,
  p_limit integer,
  p_strategy text default null
) returns setof public.tracking_jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select j.id
    from public.tracking_jobs j
    where j.status = 'queued'
      and j.run_after <= now()
      and (p_strategy is null or j.strategy = p_strategy)
    order by j.run_after
    for update skip locked
    limit greatest(coalesce(p_limit, 1), 1)
  )
  update public.tracking_jobs j
  set status = 'running',
      locked_until = now() + interval '10 minutes',
      locked_by = p_worker,
      attempts = j.attempts + 1,
      updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

revoke all on function public.claim_tracking_jobs(text, integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_tracking_jobs(text, integer, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.tracking_shipments enable row level security;
alter table public.tracking_events enable row level security;
alter table public.tracking_jobs enable row level security;
alter table public.tracking_usage enable row level security;

drop policy if exists tracking_shipments_select on public.tracking_shipments;
create policy tracking_shipments_select on public.tracking_shipments
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

drop policy if exists tracking_events_select on public.tracking_events;
create policy tracking_events_select on public.tracking_events
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- tracking_jobs e tracking_usage: sem policies, acesso apenas via service role.

grant select on public.tracking_shipments to authenticated;
grant select on public.tracking_events to authenticated;
grant select, insert, update, delete
  on public.tracking_shipments, public.tracking_events,
     public.tracking_jobs, public.tracking_usage
  to service_role;
