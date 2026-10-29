-- Rastreio: histórico de ETA (atraso) e cache de geocodificação dos portos (mapa).

-- Primeiro ETA informado pelo armador e data real de chegada. O atraso é
-- `(coalesce(ata, eta) - eta_original)` em dias.
alter table public.tracking_shipments
  add column if not exists eta_original date,
  add column if not exists ata date;

comment on column public.tracking_shipments.eta_original is 'Primeiro ETA informado pelo armador (base do atraso).';
comment on column public.tracking_shipments.ata is 'Data real de chegada (evento Arrived/Discharged).';

-- Cache de geocodificação de POL/POD. Chave = consulta normalizada
-- (`shekou, china`). Só o service role acessa (RLS sem policies).
create table if not exists public.port_geocodes (
  id uuid primary key default gen_random_uuid(),
  query text not null unique,
  display_name text,
  lat double precision not null,
  lng double precision not null,
  provider text not null default 'nominatim',
  resolved_at timestamptz not null default now()
);

comment on table public.port_geocodes is 'Cache de geocodificação de portos (POL/POD) para o mapa de rota.';

alter table public.port_geocodes enable row level security;
