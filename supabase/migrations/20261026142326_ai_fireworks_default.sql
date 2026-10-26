-- Fireworks como provedor padrão da análise (OpenRouter continua aceito).
--
-- A linha `ai` de `app_settings` é forçada para Fireworks + router DeepSeek.
-- Aplique esta migration SOMENTE depois de configurar `FIREWORKS_API_KEY` no
-- ambiente (local/Vercel); sem a chave, health e análises passam a responder
-- 503/502.
--
-- Rollback:
--   update public.app_settings
--      set provider = 'openrouter', model = '~openai/gpt-luna-latest'
--    where key = 'ai';

alter table public.app_settings
  drop constraint if exists app_settings_provider_check;

alter table public.app_settings
  add constraint app_settings_provider_check
  check (provider in ('fireworks', 'openrouter'));

insert into public.app_settings (key, provider, model)
values ('ai', 'fireworks', 'accounts/fireworks/routers/deepseek-flash-latest')
on conflict (key) do update
  set provider = excluded.provider,
      model = excluded.model,
      updated_by = null;
