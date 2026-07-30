-- ============================================================================
-- Confere.ia — schema inicial multi-tenant com RLS
-- ============================================================================

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- As funcoes security definer abaixo referenciam tabelas criadas mais adiante
-- neste mesmo arquivo. Sem isto, o Postgres valida o corpo das funcoes SQL na
-- criacao (check_function_bodies = on por padrao) e falha com
-- "relation public.tenant_members does not exist".
set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- Schema privado: funcoes security definer NUNCA ficam em schema exposto
-- ---------------------------------------------------------------------------
create schema if not exists private;

-- tenant_id do JWT (app_metadata — nunca user_metadata, que e editavel pelo usuario)
create or replace function private.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif((select auth.jwt() -> 'app_metadata' ->> 'tenant_id'), '')::uuid
$$;

-- role do usuario no tenant atual
create or replace function private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif((select auth.jwt() -> 'app_metadata' ->> 'tenant_role'), '')
$$;

create or replace function private.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = (select auth.uid())
  )
$$;

create or replace function private.has_tenant_role(p_tenant_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = (select auth.uid())
      and tm.role = any (p_roles)
  )
$$;

revoke all on function private.current_tenant_id() from public;
revoke all on function private.current_role() from public;
revoke all on function private.is_tenant_member(uuid) from public;
revoke all on function private.has_tenant_role(uuid, text[]) from public;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document_cnpj text,
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  validation_rules jsonb not null default '{}'::jsonb,
  ai_overrides jsonb not null default '{}'::jsonb,
  confidence_threshold numeric not null default 0.7,
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  sku text not null,
  description text not null,
  ncm text,
  unit_weight numeric,
  unit_of_measure text,
  attributes jsonb not null default '{}'::jsonb,
  origin text not null default 'manual' check (origin in ('manual', 'ai')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_tenant_sku_key unique (tenant_id, sku)
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reference_number text not null,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'awaiting_review', 'completed', 'rejected')),
  supplier_name text,
  incoterm text,
  currency text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  import_id uuid not null references public.imports (id) on delete cascade,
  doc_type text not null check (doc_type in ('invoice', 'packing_list', 'bill_of_lading')),
  storage_path text not null,
  sha256 text not null default '',
  version integer not null default 1,
  status text not null default 'pending' check (status in ('pending', 'extracted', 'failed')),
  original_filename text,
  content_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  constraint documents_import_type_version_key unique (import_id, doc_type, version)
);

create table public.extraction_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  model text not null,
  payload jsonb not null,
  confidence jsonb not null default '{}'::jsonb,
  tokens_used integer,
  created_at timestamptz not null default now()
);

create table public.analysis_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  import_id uuid not null references public.imports (id) on delete cascade,
  analysis_type text not null check (analysis_type in ('comparison', 'product_match', 'validation')),
  findings jsonb not null default '[]'::jsonb,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  created_at timestamptz not null default now()
);

create table public.product_matches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  import_id uuid not null references public.imports (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  extracted_data jsonb not null,
  match_status text not null check (match_status in ('new', 'existing_match', 'divergent')),
  differences jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid references auth.users (id),
  entity text not null,
  entity_id uuid not null,
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  capability text not null,
  model text not null,
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  latency_ms integer not null default 0,
  status text not null check (status in ('success', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indices
-- ---------------------------------------------------------------------------

create index products_tenant_description_trgm_idx
  on public.products using gin (description gin_trgm_ops);
create index imports_tenant_status_idx on public.imports (tenant_id, status);
create index imports_tenant_created_idx on public.imports (tenant_id, created_at desc);
create index documents_tenant_status_idx on public.documents (tenant_id, status);
create index documents_sha256_idx on public.documents (tenant_id, sha256);
create index extraction_results_document_idx on public.extraction_results (document_id);
create index extraction_results_tenant_idx on public.extraction_results (tenant_id);
create index analysis_results_import_idx on public.analysis_results (import_id);
create index product_matches_import_idx on public.product_matches (import_id);
create index product_matches_product_idx on public.product_matches (product_id);
create index audit_logs_tenant_entity_idx on public.audit_logs (tenant_id, entity);
create index ai_logs_tenant_created_idx on public.ai_logs (tenant_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at automatico
-- ---------------------------------------------------------------------------

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public;

create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();
create trigger imports_touch before update on public.imports
  for each row execute function private.touch_updated_at();
create trigger tenant_settings_touch before update on public.tenant_settings
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Bootstrap de tenant (signup): cria tenant + owner + settings padrao
-- ---------------------------------------------------------------------------

create or replace function public.create_tenant_with_owner(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'usuario nao autenticado';
  end if;

  insert into public.tenants (name) values (p_name) returning id into v_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant_id, (select auth.uid()), 'owner');

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);

  return v_tenant_id;
end;
$$;

revoke all on function public.create_tenant_with_owner(text) from public;
grant execute on function public.create_tenant_with_owner(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Custom Access Token Hook: injeta tenant_id e tenant_role no JWT
-- (habilitar em Auth > Hooks no projeto Supabase)
-- ---------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims jsonb;
  v_tenant_id uuid;
  v_role text;
begin
  select tm.tenant_id, tm.role
    into v_tenant_id, v_role
  from public.tenant_members tm
  where tm.user_id = (event ->> 'user_id')::uuid
  order by tm.created_at asc
  limit 1;

  claims := event -> 'claims';

  if v_tenant_id is not null then
    claims := jsonb_set(claims, '{app_metadata,tenant_id}', to_jsonb(v_tenant_id::text));
    claims := jsonb_set(claims, '{app_metadata,tenant_role}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

revoke all on function public.custom_access_token_hook(jsonb) from public;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on table public.tenant_members to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- RLS: habilitado em TODAS as tabelas expostas
-- ---------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.tenant_members enable row level security;
alter table public.tenant_settings enable row level security;
alter table public.products enable row level security;
alter table public.imports enable row level security;
alter table public.documents enable row level security;
alter table public.extraction_results enable row level security;
alter table public.analysis_results enable row level security;
alter table public.product_matches enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ai_logs enable row level security;

-- tenants: membros leem; owners/admins atualizam
create policy tenants_select on public.tenants
  for select to authenticated
  using ((select private.is_tenant_member(id)));

create policy tenants_update on public.tenants
  for update to authenticated
  using ((select private.has_tenant_role(id, array['owner', 'admin'])))
  with check ((select private.has_tenant_role(id, array['owner', 'admin'])));

-- tenant_members: membros leem; owners/admins gerenciam
create policy tenant_members_select on public.tenant_members
  for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));

create policy tenant_members_insert on public.tenant_members
  for insert to authenticated
  with check ((select private.has_tenant_role(tenant_id, array['owner', 'admin'])));

create policy tenant_members_update on public.tenant_members
  for update to authenticated
  using ((select private.has_tenant_role(tenant_id, array['owner', 'admin'])))
  with check ((select private.has_tenant_role(tenant_id, array['owner', 'admin'])));

create policy tenant_members_delete on public.tenant_members
  for delete to authenticated
  using (
    (select private.has_tenant_role(tenant_id, array['owner', 'admin']))
    and user_id <> (select auth.uid())
  );

-- tenant_settings: membros leem; owners/admins atualizam
create policy tenant_settings_select on public.tenant_settings
  for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));

create policy tenant_settings_update on public.tenant_settings
  for update to authenticated
  using ((select private.has_tenant_role(tenant_id, array['owner', 'admin'])))
  with check ((select private.has_tenant_role(tenant_id, array['owner', 'admin'])));

-- products: leitura por membros; escrita por owner/admin/operator
create policy products_select on public.products
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy products_insert on public.products
  for insert to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

create policy products_update on public.products
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

create policy products_delete on public.products
  for delete to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin')
  );

-- imports
create policy imports_select on public.imports
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy imports_insert on public.imports
  for insert to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

create policy imports_update on public.imports
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

-- documents
create policy documents_select on public.documents
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

create policy documents_update on public.documents
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

-- extraction_results / analysis_results / product_matches: leitura por membros.
-- Escrita apenas via service_role (worker), que bypassa RLS.
create policy extraction_results_select on public.extraction_results
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy analysis_results_select on public.analysis_results
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy product_matches_select on public.product_matches
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- audit_logs e ai_logs: somente leitura para membros
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy ai_logs_select on public.ai_logs
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

-- ---------------------------------------------------------------------------
-- Storage: bucket privado + policies por tenant (pasta raiz = tenant_id)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('import-documents', 'import-documents', false)
on conflict (id) do nothing;

create policy import_documents_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'import-documents'
    and (storage.foldername(name))[1] = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  );

create policy import_documents_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'import-documents'
    and (storage.foldername(name))[1] = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

-- upsert exige INSERT + SELECT + UPDATE
create policy import_documents_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'import-documents'
    and (storage.foldername(name))[1] = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
  );

create policy import_documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'import-documents'
    and (storage.foldername(name))[1] = (select auth.jwt() -> 'app_metadata' ->> 'tenant_id')
    and (select private.current_role()) in ('owner', 'admin')
  );
