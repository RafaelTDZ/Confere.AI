-- Verifica se um email ja esta cadastrado em auth.users.
-- Usado pelo fluxo de login (email primeiro) sem criar usuarios fantasma.

create or replace function public.email_registered(p_email text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from auth.users u
    where lower(u.email) = lower(trim(p_email))
  );
$$;

revoke all on function public.email_registered(text) from public;
grant execute on function public.email_registered(text) to anon, authenticated;
