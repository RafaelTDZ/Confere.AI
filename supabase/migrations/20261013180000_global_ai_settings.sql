-- Config global da aplicação (vale para todos os tenants/usuários).
-- Linha única 'ai': provider/model NULL = padrão do servidor (env).
-- Sem policies para anon/authenticated: só service role (servidor) lê/escreve.

create table public.app_settings (
  key text primary key,
  provider text check (provider in ('openrouter', 'fireworks')),
  model text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create trigger app_settings_touch before update on public.app_settings
  for each row execute function private.touch_updated_at();

insert into public.app_settings (key)
values ('ai')
on conflict (key) do nothing;
