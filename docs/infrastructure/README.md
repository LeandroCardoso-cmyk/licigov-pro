# Documentação de Infraestrutura

## Ambientes

| Ambiente | URL | Branch | Deploy |
|---------|-----|--------|--------|
| Produção | licigov.railway.app | `main` | Auto (push) |
| Staging | — | `fix/staging-*` | Manual |

## Railway

### Configuração do Serviço
- **Plataforma:** Railway
- **Banco:** MySQL 8 (Railway Plugin)
- **Build:** `pnpm build` (esbuild)
- **Start:** `node dist/server/index.js`
- **Porta:** `process.env.PORT || 3000`

### Variáveis de Ambiente Obrigatórias
```env
DATABASE_URL          # MySQL connection string
ADMIN_EMAIL           # Email do admin inicial
ADMIN_PASSWORD        # Senha do admin inicial
JWT_SECRET            # Segredo para JWT
AWS_BUCKET            # Bucket S3 para uploads
AWS_REGION            # Região AWS
AWS_ACCESS_KEY_ID     # Credencial AWS
AWS_SECRET_ACCESS_KEY # Credencial AWS
```

## Bootstrap na Inicialização

Na startup, o servidor executa em ordem:
1. `runMigrations()` — aplica migrações Drizzle pendentes
2. `ensureSchema()` — safety nets para colunas críticas
3. `seedAdmin()` — garante usuário admin inicial

## Monitoramento

- Logs via Railway dashboard
- Health check: `GET /health` → `{ status: "ok" }`
- Métricas de uso: Railway metrics dashboard
