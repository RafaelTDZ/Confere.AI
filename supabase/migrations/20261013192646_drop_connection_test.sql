-- Limpeza de artefato de teste de conexão (tabela + histórico).
-- Operação remota única; reaplicar é no-op (DROP IF EXISTS).
DROP TABLE IF EXISTS public.connection_test;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261008184040';
