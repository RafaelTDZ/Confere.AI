-- Rate limit persistido no Postgres (janela fixa por bucket).
-- Sem policies: a tabela e a função são acessadas apenas via service role.
-- Idempotente: pode ser reaplicada com segurança.

create table if not exists public.rate_limit_buckets (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);

create index if not exists rate_limit_buckets_window_start_idx
  on public.rate_limit_buckets (window_start);

alter table public.rate_limit_buckets enable row level security;
-- Sem policies: a tabela é acessada apenas via service role/função.

grant select, insert, update, delete on public.rate_limit_buckets to service_role;

create or replace function public.consume_rate_limit(
  p_bucket text,
  p_window_seconds integer,
  p_limit integer
) returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_window_seconds <= 0 or p_limit <= 0 then
    raise exception 'p_window_seconds e p_limit devem ser positivos';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_buckets (bucket, window_start, count)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start)
  do update set count = public.rate_limit_buckets.count + 1
  returning count into v_count;

  return query
    select
      v_count <= p_limit,
      greatest(p_limit - v_count, 0),
      v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;
