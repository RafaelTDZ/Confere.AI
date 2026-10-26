-- DATA-01: operações compostas de importação em uma única transação.
--
-- * `merge_imports` consolida a importação de origem na de destino: documentos
--   (com versão nova por tipo), resultados, matches, ai_logs, chaves e partes,
--   e só então remove a origem. Tudo em uma transação: falha em qualquer passo
--   desfaz o merge inteiro.
-- * `delete_import` devolve os storage_paths dos documentos e remove a
--   importação (documentos/extrações caem por FK em cascata) atomicamente.
-- * `imports.status` ganha `failed` para registrar análise interrompida.
--
-- As funções rodam como invoker e só o service_role recebe EXECUTE; o tenant_id
-- vem sempre da sessão autenticada na aplicação (nunca do corpo da request).

alter table public.imports drop constraint if exists imports_status_check;
alter table public.imports
  add constraint imports_status_check
  check (
    status = any (
      array[
        'uploaded'::text,
        'processing'::text,
        'awaiting_review'::text,
        'completed'::text,
        'rejected'::text,
        'failed'::text
      ]
    )
  );

create or replace function public.merge_imports(
  p_tenant_id uuid,
  p_source_id uuid,
  p_target_id uuid,
  p_supplier_name text default null
) returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_source public.imports%rowtype;
  v_target_id uuid;
begin
  if p_source_id = p_target_id then
    raise exception 'importacao origem e destino iguais' using errcode = '22023';
  end if;

  select * into v_source
  from public.imports
  where id = p_source_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'importacao origem nao encontrada' using errcode = 'P0002';
  end if;

  select id into v_target_id
  from public.imports
  where id = p_target_id and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'importacao destino nao encontrada' using errcode = 'P0002';
  end if;

  -- 1) documentos: versão nova por tipo, acima da maior versão do destino
  with target_max as (
    select doc_type, coalesce(max(version), 0) as max_version
    from public.documents
    where tenant_id = p_tenant_id and import_id = p_target_id
    group by doc_type
  ),
  source_docs as (
    select
      id,
      doc_type,
      row_number() over (
        partition by doc_type
        order by created_at, id
      ) as rn
    from public.documents
    where tenant_id = p_tenant_id and import_id = p_source_id
  )
  update public.documents as d
  set
    import_id = p_target_id,
    version = coalesce(tm.max_version, 0) + sd.rn
  from source_docs as sd
  left join target_max as tm on tm.doc_type = sd.doc_type
  where d.id = sd.id;

  -- 2) resultados, correspondências e logs de IA acompanham o destino
  update public.analysis_results
  set import_id = p_target_id
  where tenant_id = p_tenant_id and import_id = p_source_id;

  update public.product_matches
  set import_id = p_target_id
  where tenant_id = p_tenant_id and import_id = p_source_id;

  update public.ai_logs
  set import_id = p_target_id
  where tenant_id = p_tenant_id and import_id = p_source_id;

  -- 3) chaves: libera os índices únicos da origem antes de preencher o destino.
  --    O destino mantém o que já tem; fornecedor informado na edição tem
  --    precedência sobre o da origem.
  update public.imports
  set invoice_number = null, bl_number = null
  where id = p_source_id and tenant_id = p_tenant_id;

  update public.imports
  set
    invoice_number = coalesce(invoice_number, v_source.invoice_number),
    bl_number = coalesce(bl_number, v_source.bl_number),
    supplier_name = coalesce(
      supplier_name,
      nullif(btrim(p_supplier_name), ''),
      v_source.supplier_name
    ),
    consignee_id = coalesce(consignee_id, v_source.consignee_id),
    notify_id = coalesce(notify_id, v_source.notify_id)
  where id = p_target_id and tenant_id = p_tenant_id;

  -- 4) origem sem documentos/chaves pode ser removida
  delete from public.imports
  where id = p_source_id and tenant_id = p_tenant_id;

  return p_target_id;
end;
$$;

create or replace function public.delete_import(
  p_tenant_id uuid,
  p_import_id uuid
) returns text[]
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_paths text[];
begin
  select coalesce(array_agg(storage_path order by storage_path), '{}'::text[])
  into v_paths
  from public.documents
  where tenant_id = p_tenant_id and import_id = p_import_id;

  delete from public.imports
  where id = p_import_id and tenant_id = p_tenant_id;

  if not found then
    raise exception 'importacao nao encontrada' using errcode = 'P0002';
  end if;

  return v_paths;
end;
$$;

revoke all on function public.merge_imports(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.delete_import(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.merge_imports(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.delete_import(uuid, uuid)
  to service_role;
