-- Listagem de importações: ordenação por ETA.
-- O ETA oficial continua no payload da extração de BL (`payload->>'eta'`,
-- DD/MM/AAAA). A coluna abaixo é uma cópia denormalizada para o ORDER BY do
-- banco, mantida pela aplicação (`syncImportEta`) sempre que o BL muda.

alter table public.imports
  add column if not exists eta date;

comment on column public.imports.eta is 'ETA do embarque, espelho do payload.eta da extração de BL mais recente. Denormalizado para ordenação; a fonte da verdade é o payload.';

create index if not exists imports_tenant_eta_idx on public.imports (tenant_id, eta);

-- Backfill: ETA da extração de BL mais recente de cada importação. Valor
-- vazio ou inválido (ex.: 31/02/2026) fica nulo.
create or replace function public.tmp_parse_eta_br(value text)
returns date
language plpgsql
immutable
as $$
declare
  parsed date;
begin
  if value is null or value !~ '^\s*\d{2}/\d{2}/\d{4}\s*$' then
    return null;
  end if;
  parsed := to_date(trim(value), 'DD/MM/YYYY');
  if to_char(parsed, 'DD/MM/YYYY') <> trim(value) then
    return null;
  end if;
  return parsed;
exception when others then
  return null;
end;
$$;

with latest_bl_eta as (
  select distinct on (d.import_id)
    d.import_id,
    er.payload->>'eta' as eta_text
  from public.documents d
  join public.extraction_results er on er.document_id = d.id
  where d.doc_type = 'bill_of_lading'
    and d.import_id is not null
  order by d.import_id, er.created_at desc
)
update public.imports i
set eta = public.tmp_parse_eta_br(l.eta_text)
from latest_bl_eta l
where i.id = l.import_id;

drop function public.tmp_parse_eta_br(text);
