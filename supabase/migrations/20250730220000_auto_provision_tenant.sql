-- Provisiona tenant automaticamente no signup (sem tela de onboarding).

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_name text;
  v_full_name text;
begin
  v_full_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '');
  v_name := coalesce(
    v_full_name,
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Minha empresa'
  );

  insert into public.tenants (name)
  values (v_name)
  returning id into v_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role, full_name, company_name)
  values (v_tenant_id, new.id, 'owner', v_full_name, v_name);

  insert into public.tenant_settings (tenant_id)
  values (v_tenant_id);

  new.raw_app_meta_data :=
    coalesce(new.raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object(
      'tenant_id', v_tenant_id::text,
      'tenant_role', 'owner'
    );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  before insert on auth.users
  for each row
  execute function private.handle_new_user();
