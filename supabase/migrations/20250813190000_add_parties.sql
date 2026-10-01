-- Catálogo de consignee / notify por tenant e vínculo na importação.

create table public.parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  cnpj text not null,
  cnpj_digits text not null,
  address text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint parties_tenant_cnpj_digits_key unique (tenant_id, cnpj_digits),
  constraint parties_cnpj_digits_check check (cnpj_digits ~ '^[0-9]{14}$')
);

create index parties_tenant_idx on public.parties (tenant_id);

alter table public.imports
  add column consignee_id uuid references public.parties (id) on delete set null,
  add column notify_id uuid references public.parties (id) on delete set null;

create index imports_consignee_idx
  on public.imports (consignee_id)
  where consignee_id is not null;

create index imports_notify_idx
  on public.imports (notify_id)
  where notify_id is not null;

create trigger parties_touch before update on public.parties
  for each row execute function private.touch_updated_at();

alter table public.parties enable row level security;

create policy parties_select on public.parties
  for select to authenticated
  using (tenant_id = (select private.current_tenant_id()));

create policy parties_insert on public.parties
  for insert to authenticated
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );

create policy parties_update on public.parties
  for update to authenticated
  using (tenant_id = (select private.current_tenant_id()))
  with check (
    tenant_id = (select private.current_tenant_id())
    and (select private.current_role()) in ('owner', 'admin', 'operator')
  );
