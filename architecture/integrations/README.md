# Integrations Architecture

## Integrações Ativas

### Railway (Infraestrutura)
- Deploy automático via push para `main`
- MySQL 8 managed (backup automático diário)
- Variáveis de ambiente via Railway dashboard
- Logs centralizados

### AWS S3 (Armazenamento de Arquivos)
- Upload de arquivos via presigned URLs
- Configuração em `server/config/aws.ts`
- `AWS_CONFIG.bucket`, `AWS_CONFIG.region`
- Anexos documentais: key = `org_{orgId}/doc_{docId}/{filename}`

### IA / LLM (Sprint 4+)
- Configuração em `server/config/ai.ts`
- `AI_CONFIG` com provider e modelo
- Uso planejado: normalização de descrições, matching CATMAT

## Integrações Planejadas (Roadmap)

### PNCP (Portal Nacional de Contratações Públicas)
- Publicação automática de editais
- Consulta de preços históricos
- API REST pública

### ComprasNet
- Integração com sistema federal de compras
- Importação de catálogos

### ICP-Brasil (Assinatura Digital)
- Certificados digitais para assinatura de documentos
- Sprint 6

## Padrão de Configuração

```typescript
// server/config/aws.ts
export const AWS_CONFIG = {
  region: process.env.AWS_S3_REGION ?? "us-east-1",
  bucket: process.env.AWS_BUCKET ?? "",
  accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
};
```

Nenhuma credencial hardcoded. Sempre via variáveis de ambiente.
