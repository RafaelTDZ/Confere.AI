-- Concilia o histórico remoto com os nomes dos arquivos em supabase/migrations/.
-- As migrations foram aplicadas com o conteúdo exato dos arquivos locais;
-- só os carimbos de versão divergiam. Sem isso, `supabase db push` tentaria
-- reaplicar tudo e falharia (tabelas já existem).
-- Reaplicar é no-op (nenhum WHERE encontra linhas).
UPDATE supabase_migrations.schema_migrations SET version = '20250730120000' WHERE version = '20261013182431';
UPDATE supabase_migrations.schema_migrations SET version = '20250730130000' WHERE version = '20261013182437';
UPDATE supabase_migrations.schema_migrations SET version = '20250730200000' WHERE version = '20261013182441';
UPDATE supabase_migrations.schema_migrations SET version = '20250730210000' WHERE version = '20261013182446';
UPDATE supabase_migrations.schema_migrations SET version = '20250730220000' WHERE version = '20261013182454';
UPDATE supabase_migrations.schema_migrations SET version = '20250730230000' WHERE version = '20261013182459';
UPDATE supabase_migrations.schema_migrations SET version = '20250731190000' WHERE version = '20261013182504';
UPDATE supabase_migrations.schema_migrations SET version = '20250803180000' WHERE version = '20261013182509';
UPDATE supabase_migrations.schema_migrations SET version = '20250813190000' WHERE version = '20261013182514';
UPDATE supabase_migrations.schema_migrations SET version = '20250813200000' WHERE version = '20261013182519';
UPDATE supabase_migrations.schema_migrations SET version = '20250813210000' WHERE version = '20261013182527';
UPDATE supabase_migrations.schema_migrations SET version = '20250813220000' WHERE version = '20261013182532';
UPDATE supabase_migrations.schema_migrations SET version = '20260814113834' WHERE version = '20261013182538';
UPDATE supabase_migrations.schema_migrations SET version = '20261013180000' WHERE version = '20261013191224';
