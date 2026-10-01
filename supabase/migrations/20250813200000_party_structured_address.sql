-- Endereço de parties em campos separados.
-- Mantém `address` (texto legado) para não quebrar linhas já gravadas.

alter table public.parties
  add column if not exists street text,
  add column if not exists street_number text,
  add column if not exists complement text,
  add column if not exists postal_code text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists country text,
  add column if not exists other_info text;
