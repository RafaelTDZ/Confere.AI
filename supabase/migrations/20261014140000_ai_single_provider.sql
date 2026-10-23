-- Provedor único de IA: OpenRouter. Remove o "opencode" da config global.
-- Linhas legadas com outros providers voltam ao padrão do servidor (env).

update public.app_settings
  set provider = null
  where key = 'ai' and provider is not null and provider <> 'openrouter';

alter table public.app_settings drop constraint if exists app_settings_provider_check;

alter table public.app_settings
  add constraint app_settings_provider_check
  check (provider in ('openrouter'));
