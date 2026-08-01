# Documentação de Integrações

## Integrações Documentadas

### Railway
- Deploy automático via push para `main`
- MySQL managed com backup diário
- Variáveis de ambiente e logs centralizados
- Ver [../../architecture/integrations/README.md](../../architecture/integrations/README.md)

### AWS S3
- Armazenamento de arquivos (attachments, uploads)
- Presigned URLs para upload direto do cliente
- Configuração: `AWS_S3_BUCKET`, `AWS_S3_REGION`, `AWS_ACCESS_KEY_ID`

### IA / LLM (Sprint 4)
- Integração planejada para normalização de descrições
- Matching semântico CATMAT
- Revisão automatizada de cláusulas

## Integrações Planejadas

| Integração | Sprint | Prioridade |
|-----------|--------|-----------|
| BullMQ + Redis | 3 | Alta (fila persistente) |
| PNCP | 7 | Média |
| ComprasNet | 7 | Média |
| ICP-Brasil | 6 | Alta (assinatura digital) |

## Variáveis de Ambiente por Integração

```env
# Railway / Database
DATABASE_URL=mysql://...

# AWS S3
AWS_S3_REGION=us-east-1
AWS_BUCKET=licigov-uploads
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# IA (Sprint 4)
AI_PROVIDER=anthropic
AI_MODEL=claude-opus-4-7
AI_API_KEY=...

# Redis (Sprint 3)
REDIS_URL=redis://...
```
