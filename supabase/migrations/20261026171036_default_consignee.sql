-- Consignee padrão por tenant + divergências verificadas na importação.
--
-- `default_consignee_party_id` aponta para uma empresa do tenant (parties) que
-- representa o importador fixo. O pipeline vincula essa empresa como consignee
-- de todas as importações e compara os dados extraídos do documento.
--
-- `imports.consignee_divergences` guarda a lista de campos divergentes
-- (`[{ field, label, documentValue, defaultConsigneeValue }]`) para o badge da
-- listagem; o detalhe recalcula com os dados atuais do consignee padrão.

alter table public.tenant_settings
  add column if not exists default_consignee_party_id uuid
  references public.parties (id) on delete set null;

alter table public.imports
  add column if not exists consignee_divergences jsonb;

notify pgrst, 'reload schema';
