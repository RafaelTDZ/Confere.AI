# AGENTS.md

## Cursor Cloud specific instructions

Confere.ia é um monorepo pnpm + Turborepo (web + Supabase local).
Comandos padrão (lint/typecheck/test/build/dev) estão no `README.md` e no `package.json` raiz — use-os.

### Serviços

- **Supabase local** (Docker): Postgres 54322, API 54321, Studio 54323. Fornece DB, Auth e Storage.
- **Web** (`apps/web`, Next.js): `http://localhost:3000`. Login/signup e página `/analise`.

### Como subir o ambiente (ordem importa)

1. Docker precisa estar rodando antes do Supabase. O daemon não sobe sozinho no boot:
   inicie com `sudo dockerd &` (usa storage-driver `fuse-overlayfs`, já configurado em `/etc/docker/daemon.json`).
2. `pnpm db:start` (`supabase start`) sobe o stack e aplica as migrations.
3. `pnpm dev` sobe o web.

### Cuidados não-óbvios

- **Supabase CLI fixado em 2.x estável (ex.: 2.34.3), NÃO a 2.110+.** O engine novo de aplicação
  de migrations (effect/sql) tem um parser de statements bugado que quebra funções dollar-quoted
  e reporta erros sem a mensagem real do Postgres. Uma 2.x de 2025 aplica as migrations normalmente.
- **Chaves do Supabase local são determinísticas** (JWT demo). O `.env` já contém a `anon` e a
  `service_role` key locais; `.env` é gitignored. Se precisar recriá-lo: `cp .env.example .env`
  e cole as chaves impressas por `supabase start`.
