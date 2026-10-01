-- Referência passa a ser identificador do usuário (opcional até o save).
-- O unique (tenant_id, reference_number) já permite vários NULL no Postgres.

alter table public.imports
  alter column reference_number drop not null;
