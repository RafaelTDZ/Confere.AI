-- Catálogo de NCM/HS por tenant.

create table public.ncms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  code text not null,
  description text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ncms_tenant_code_key unique (tenant_id, code)
);

create index ncms_tenant_idx on public.ncms (tenant_id);

create trigger ncms_touch before update on public.ncms
  for each row execute function private.touch_updated_at();

alter table public.ncms enable row level security;

create policy ncms_select on public.ncms
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy ncms_insert on public.ncms
  for insert to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

create policy ncms_update on public.ncms
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

create policy ncms_delete on public.ncms
  for delete to authenticated
  using (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin')
  );
