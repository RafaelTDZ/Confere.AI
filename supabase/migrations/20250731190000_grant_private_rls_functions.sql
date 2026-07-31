-- Corrige RLS: policies chamam private.* security definer, mas o revoke
-- from public removeu EXECUTE sem conceder de volta a authenticated.
-- Sem isso: "permission denied for function current_tenant_id / is_tenant_member".

grant usage on schema private to authenticated;

grant execute on function private.current_tenant_id() to authenticated;
grant execute on function private.current_role() to authenticated;
grant execute on function private.is_tenant_member(uuid) to authenticated;
grant execute on function private.has_tenant_role(uuid, text[]) to authenticated;
