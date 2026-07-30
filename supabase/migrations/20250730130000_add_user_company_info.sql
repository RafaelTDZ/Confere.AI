-- Adiciona campos de nome completo do usuário e nome da empresa na tabela tenant_members
-- Esses campos são preenchidos durante o signup

alter table public.tenant_members
add column full_name text,
add column company_name text;

-- Comentários para documentação
comment on column public.tenant_members.full_name is 'Nome completo do usuário';
comment on column public.tenant_members.company_name is 'Nome da empresa/organização';
