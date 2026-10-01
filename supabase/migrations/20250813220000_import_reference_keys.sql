-- Chaves de consolidação da importação: invoice/BL + referência única por tenant.

alter table public.imports
  add column if not exists invoice_number text,
  add column if not exists bl_number text;

-- Referências geradas iguais (mesmo hash/dia) impedem o unique; desambigua as mais novas.
with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, reference_number
      order by created_at, id
    ) as rn
  from public.imports
)
update public.imports as i
set reference_number = i.reference_number || '-' || substr(i.id::text, 1, 6)
from ranked as r
where i.id = r.id
  and r.rn > 1;

create unique index if not exists imports_tenant_reference_number_key
  on public.imports (tenant_id, reference_number);

create index if not exists imports_tenant_invoice_number_idx
  on public.imports (tenant_id, invoice_number)
  where invoice_number is not null;

create index if not exists imports_tenant_bl_number_idx
  on public.imports (tenant_id, bl_number)
  where bl_number is not null;
