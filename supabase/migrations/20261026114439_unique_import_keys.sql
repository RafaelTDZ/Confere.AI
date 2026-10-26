-- Consolidação de importações: bl_number e invoice_number são chaves 1:1 por tenant.
--
-- Regra de negócio:
--   * no máximo uma importação por (tenant_id, bl_number) e uma por
--     (tenant_id, invoice_number);
--   * quando o documento traz BL e Invoice, o BL tem precedência na escolha da
--     importação (findImportByKeys consulta bl_number antes de invoice_number);
--   * se a outra chave já pertence a outra importação, ela não é copiada (fica
--     nula na importação reutilizada) e o processamento continua.
--
-- Idempotente: pode ser reaplicada com segurança. Não deleta linhas.

-- Dedupe defensivo: mantém a importação mais antiga de cada chave e anula a
-- chave nas duplicadas — o índice único abaixo não aceita repetição.
with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, bl_number
      order by created_at, id
    ) as rn
  from public.imports
  where bl_number is not null
)
update public.imports as i
set bl_number = null
from ranked as r
where i.id = r.id
  and r.rn > 1;

with ranked as (
  select
    id,
    row_number() over (
      partition by tenant_id, invoice_number
      order by created_at, id
    ) as rn
  from public.imports
  where invoice_number is not null
)
update public.imports as i
set invoice_number = null
from ranked as r
where i.id = r.id
  and r.rn > 1;

-- Os índices comuns criados em 20250813220000_import_reference_keys.sql são
-- substituídos pelos únicos (parciais: só valem quando a chave não é nula).
drop index if exists public.imports_tenant_bl_number_idx;
drop index if exists public.imports_tenant_invoice_number_idx;

create unique index if not exists imports_tenant_bl_number_key
  on public.imports (tenant_id, bl_number)
  where bl_number is not null;

create unique index if not exists imports_tenant_invoice_number_key
  on public.imports (tenant_id, invoice_number)
  where invoice_number is not null;
