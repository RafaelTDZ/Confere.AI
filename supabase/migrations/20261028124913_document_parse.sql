-- ============================================================================
-- Parse de PDF em markdown (Firecrawl `/v2/parse`)
-- Cache por (tenant_id, sha256) e orçamento mensal em créditos/páginas.
-- Escrita/leitura apenas via service role (worker roda sem cookie).
-- ============================================================================

create table if not exists public.document_parses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sha256 text not null,
  provider text not null default 'firecrawl',
  -- `status` fica registrado para operação/observabilidade (`docs/pdf-markdown.md`);
  -- hoje só o caminho feliz é cacheado, sempre como 'parsed'.
  status text not null default 'parsed',
  markdown text not null,
  pages integer not null default 1,
  credits integer not null default 0,
  created_at timestamptz not null default now(),
  constraint document_parses_tenant_sha_key unique (tenant_id, sha256)
);

create table if not exists public.document_parse_usage (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  period text not null,
  credits_used integer not null default 0,
  parses integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, period)
);

-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------

create index if not exists document_parses_tenant_created_idx
  on public.document_parses (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

drop trigger if exists document_parse_usage_touch on public.document_parse_usage;
create trigger document_parse_usage_touch
  before update on public.document_parse_usage
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Orçamento de créditos (Firecrawl) por tenant/mês
-- Retorna false quando o teto seria ultrapassado (nada é gravado).
-- ---------------------------------------------------------------------------

create or replace function public.consume_document_parse_credits(
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
    from public.document_parse_usage
    where tenant_id = p_tenant_id and period = p_period
    for update;

    if coalesce(v_used, 0) + p_credits > p_limit then
      return false;
    end if;
  end if;

  insert into public.document_parse_usage (tenant_id, period, credits_used, parses)
  values (p_tenant_id, p_period, p_credits, case when p_credits > 0 then 1 else 0 end)
  on conflict (tenant_id, period) do update
  set credits_used = public.document_parse_usage.credits_used + excluded.credits_used,
      parses = public.document_parse_usage.parses + excluded.parses,
      updated_at = now();

  return true;
end;
$$;

revoke all on function public.consume_document_parse_credits(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_document_parse_credits(uuid, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- RLS: habilitado sem policies (somente service role)
-- ---------------------------------------------------------------------------

alter table public.document_parses enable row level security;
alter table public.document_parse_usage enable row level security;

grant select, insert, update, delete
  on public.document_parses, public.document_parse_usage
  to service_role;
