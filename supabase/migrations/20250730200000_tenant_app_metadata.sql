-- Garante tenant_id no raw_app_meta_data para o JWT incluir o claim
-- mesmo quando o Custom Access Token Hook ainda nao esta habilitado no projeto.

create or replace function public.create_tenant_with_owner(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'usuario nao autenticado';
  end if;

  if exists (
    select 1 from public.tenant_members tm where tm.user_id = v_user_id
  ) then
    raise exception 'usuario ja possui tenant';
  end if;

  insert into public.tenants (name) values (p_name) returning id into v_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant_id, v_user_id, 'owner');

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);

  update auth.users
  set raw_app_meta_data =
    coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'tenant_id', v_tenant_id::text,
      'tenant_role', 'owner'
    )
  where id = v_user_id;

  return v_tenant_id;
end;
$$;

revoke all on function public.create_tenant_with_owner(text) from public;
grant execute on function public.create_tenant_with_owner(text) to authenticated;
