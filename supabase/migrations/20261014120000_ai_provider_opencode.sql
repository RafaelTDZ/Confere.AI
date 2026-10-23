-- Troca o provider Fireworks pelo OpenCode Zen na config global de IA.
-- Mantém 'openrouter'; substitui 'fireworks' por 'opencode'.

alter table public.app_settings drop constraint if exists app_settings_provider_check;

alter table public.app_settings
  add constraint app_settings_provider_check
  check (provider in ('openrouter', 'opencode'));

-- Linhas legadas com 'fireworks' voltam ao padrão do servidor (env).
update public.app_settings
  set provider = null
  where key = 'ai' and provider = 'fireworks';
