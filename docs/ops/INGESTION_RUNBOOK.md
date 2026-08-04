# Runbook — Ingestão Canônica (PR B.2.1)

Troubleshooting da superfície `ingestion.*` e da rota de byte-upload. Somente operação — não
altera produção/secrets. Arquitetura em [`../architecture/IMPORT_ENGINE.md`](../architecture/IMPORT_ENGINE.md).

## Habilitar/desabilitar por tenant

A superfície é **fail-closed** pela flag `FF_CANONICAL_INGESTION`.

- Habilitar para um tenant: criar/ligar o registro em `tenant_feature_flags`
  (`featureFlagService.isFeatureEnabled(flagName, organizationId)`), default **desligado**.
- Kill-switch global: uma flag global desligada mantém todos os tenants bloqueados.
- Verificação rápida: `getSessionStatus` retorna `FORBIDDEN` → flag desligada para o tenant.

## Sintomas → causa provável → ação

| Sintoma (HTTP/tRPC) | Causa provável | Ação |
|---|---|---|
| `FORBIDDEN` "não habilitada" | Flag `FF_CANONICAL_INGESTION` desligada p/ o tenant | Ligar a flag do tenant |
| `401` no upload | Cookie JWT ausente/expirado | Reautenticar; conferir `sdk.authenticateRequest` |
| `403` no upload | Usuário sem membership ativo na org | Conferir `organization_members.ativo` |
| `415` "não suportado" | MIME fora de `ALLOWED_MIME_TYPES` | Enviar XLSX/CSV/PDF/DOCX válido |
| `400` "não corresponde ao tipo declarado" | *Magic bytes* ≠ MIME declarado (ex.: PDF renomeado p/ .xlsx) | Enviar o arquivo correto |
| `400` "checksum divergente" | Bytes enviados ≠ checksum declarado no `createSession` | Recalcular sha256 e reenviar |
| `413` "excede 50MB" | Arquivo acima do teto | Dividir/reduzir o arquivo |
| `409` no upload | Sessão não está mais em `uploaded` (ou re-upload com checksum diferente) | Criar nova sessão |
| `412` "arquivo ainda não enviado" (enqueue) | `enqueueProcessing` antes do upload concluir | Fazer o upload antes de enfileirar |
| `409` "estado terminal" (enqueue) | Sessão já aprovada/arquivada/rejeitada | Criar nova sessão |
| `412` "revisão incompleta" (approve) | Há itens de staging `pending` | Revisar todos os itens antes de aprovar |
| `CONFLICT` "outro arquivo" (createSession) | `idempotencyKey` reusada com checksum diferente | Usar nova chave idempotente |

## Dedup e idempotência

- **Dedup por checksum:** `createSession` reutiliza a sessão **ativa** (não `rejected`/`archived`)
  do tenant com o mesmo `checksum` → retorna `{ duplicate: true }` sem criar nova linha.
- **Idempotência de `createSession`:** por `idempotencyKey` (+ payloadHash = checksum). Replay com
  a mesma chave e mesmo arquivo retorna a resposta cacheada; com arquivo diferente → `CONFLICT`.
- **Replay do processamento:** `enqueueProcessing` é seguro para reexecutar; não duplica jobs em voo.

## Fila (in-memory)

- `importQueueService`: retry com backoff (até `MAX_RETRIES=3`), depois **DLQ**.
- Reinício do processo **esvazia** a fila in-memory: reprocessar via novo `enqueueProcessing`
  (os bytes são relidos do S3 durável — nada se perde no storage).
- Sem GEMINI/LLM no caminho (extração é 100% local/AST-based).

## Observações

- Parser **PDF/DOCX** ainda é *stub* (não extrai itens reais) — planejado para etapa posterior.
- **Nenhuma** gravação direta no domínio: itens ficam em `import_staging_items` até promoção (futura).
- Logs **nunca** contêm URL assinada, credenciais ou conteúdo de documento.
