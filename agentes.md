# Guia de Deployment - Confere.AI

## Deploy na Vercel

Este projeto é um monorepo com pnpm workspaces. O app Next.js está localizado em `apps/web`.

### Configuração Inicial

1. **Conectar o repositório ao Vercel**
   - Acesse [vercel.com](https://vercel.com)
   - Clique em "New Project"
   - Selecione este repositório do GitHub
   - O Vercel deve detectar que é um Next.js app

2. **Variáveis de Ambiente**
   
   Adicione as seguintes variáveis de ambiente no dashboard do Vercel (Settings → Environment Variables):

   ```
   # Supabase
   NEXT_PUBLIC_SUPABASE_URL
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   NEXT_PUBLIC_SUPABASE_ANON_KEY
   SUPABASE_SECRET_KEY
   SUPABASE_SERVICE_ROLE_KEY
   
   # Banco de Dados
   POSTGRES_URL
   POSTGRES_URL_NON_POOLING
   POSTGRES_PRISMA_URL
   POSTGRES_USER
   POSTGRES_PASSWORD
   POSTGRES_HOST
   POSTGRES_DATABASE
   
   # APIs
   OPENROUTER_API_KEY
   ```

3. **Arquivo de Configuração (vercel.json)**
   
   O arquivo `vercel.json` na raiz do projeto já está configurado:
   
   ```json
   {
     "buildCommand": "turbo run build",
     "outputDirectory": "apps/web/.next",
     "framework": "nextjs"
   }
   ```

### Deploy Local para Teste

Para testar o deployment localmente antes de fazer push:

```bash
# 1. Instalar dependências
pnpm install

# 2. Build do projeto
pnpm run build

# 3. Rodar o servidor de produção (a partir de apps/web)
cd apps/web
pnpm run start
```

### Deploy via CLI

Se preferir fazer deploy via CLI do Vercel:

```bash
# 1. Instalar Vercel CLI (se não tiver)
npm install -g vercel

# 2. Fazer login
vercel login

# 3. Deploy em produção
vercel deploy --prod
```

### Solução de Problemas

#### Erro 404 ao acessar o site

**Causa**: O Vercel não está detectando corretamente que é um app Next.js em monorepo.

**Solução**:
1. Certifique-se de que `next` está como dependência no `package.json` da raiz
2. Verifique se o `vercel.json` está na raiz do projeto
3. Confirme que `outputDirectory` aponta para `apps/web/.next`
4. Se ainda não funcionar, remova o projeto do Vercel e reconecte o repositório

#### Variáveis de ambiente não encontradas

**Causa**: As variáveis não foram adicionadas ao Vercel ou estão com nome errado.

**Solução**:
1. Acesse o dashboard do Vercel → projeto → Settings → Environment Variables
2. Adicione todas as variáveis listadas acima
3. Faça um novo deploy clicando em "Redeploy"

#### Build falha com erro de dependências

**Causa**: O lockfile do pnpm está desatualizado.

**Solução**:
```bash
# Atualizar o lockfile
pnpm install

# Fazer commit e push
git add pnpm-lock.yaml
git commit -m "Update pnpm lockfile"
git push
```

### Pipeline de Deploy

1. **Development**: Mudanças são feitas na branch `v0/aplicacao-2-...`
2. **Preview**: Cada push cria um preview deploy automático
3. **Production**: Merge para `main` faz deploy automático em produção

### Monitorando o Deploy

```bash
# Ver logs do servidor de produção
vercel logs --prod

# Ver status do último deploy
vercel status

# Listar todos os deployments
vercel list
```

### URLs

- **Produção**: https://confere-ai-eosin.vercel.app
- **Preview**: Criada automaticamente para cada push

---

**Última atualização**: Agosto de 2026
**Repositório**: RafaelSFelski/Confere.AI
