-- Rastreio: recuperação de jobs `running` órfãos (worker morto/timeout da function).
--
-- Antes, o claim só aceitava `queued`: um job que ficou `running` (function
-- morta no meio do scrape) nunca voltava para a fila. Como `queued`/`running`
-- contam como "busy" em `enqueueTrackingForImport`/`enqueueDueTrackingShipments`,
-- o shipment deixava de ser consultado para sempre.
--
-- Agora o claim:
--   1. marca `failed` (terminal) o `running` com lock vencido e tentativas
--      esgotadas — `stale_timeout` libera o shipment sem loop de retry;
--   2. reivindica `queued` vencido **ou** `running` com lock vencido e
--      tentativas restantes.
--
-- O overload antigo (3 parâmetros) é removido para não deixar duas versões da
-- mesma função: `p_strategy`/`p_max_attempts` têm default e o PostgREST continua
-- chamando com os mesmos nomes de antes.

drop function if exists public.claim_tracking_jobs(text, integer, text);

create or replace function public.claim_tracking_jobs(
  p_worker text,
  p_limit integer,
  p_strategy text default null,
  p_max_attempts integer default 3
) returns setof public.tracking_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_attempts integer := greatest(coalesce(p_max_attempts, 3), 1);
begin
  -- Worker morto com tentativas esgotadas: `failed` é terminal e o shipment
  -- volta a ser enfileirado pelo `enqueueDueTrackingShipments`.
  update public.tracking_jobs j
  set status = 'failed',
      last_error = 'stale_timeout',
      locked_until = null,
      locked_by = null,
      updated_at = now()
  where j.status = 'running'
    and j.locked_until < now()
    and j.attempts >= v_max_attempts;

  return query
  with picked as (
    select j.id
    from public.tracking_jobs j
    where (
        (j.status = 'queued' and j.run_after <= now())
        or (
          j.status = 'running'
          and j.locked_until < now()
          and j.attempts < v_max_attempts
        )
      )
      and (p_strategy is null or j.strategy = p_strategy)
    order by j.run_after
    for update skip locked
    limit greatest(coalesce(p_limit, 1), 1)
  )
  update public.tracking_jobs j
  set status = 'running',
      locked_until = now() + interval '10 minutes',
      locked_by = p_worker,
      attempts = j.attempts + 1,
      updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

revoke all on function public.claim_tracking_jobs(text, integer, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_tracking_jobs(text, integer, text, integer)
  to service_role;
