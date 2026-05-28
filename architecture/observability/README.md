# Observability Architecture

## Stack de Observabilidade

| Componente | Tecnologia | Uso |
|-----------|-----------|-----|
| Logs estruturados | `serviceLogger` | Logs por serviço |
| Activity audit | `activityLogService` | Auditoria de negócio |
| Correlation | `correlationId` | Rastreamento de request |
| Request ID | `requestId` | Identificação única de requisição |

## serviceLogger

```typescript
const log = serviceLogger("ImportStagingService");

log.info("evento_descritivo", { sessionId, orgId });
log.warn("evento_aviso", { sessionId, reason });
log.error("evento_erro", { error, sessionId });
log.debug("evento_debug", { payload }); // apenas em development
```

## Padrão de Evento de Log

Todo evento de log deve incluir:
- Nome do evento em `snake_case`
- `sessionId` ou `documentId` ou `entityId` (o identificador relevante)
- `organizationId` (sempre para eventos de negócio)
- Context adicional relevante

## Activity Logs vs Structured Logs

| | Activity Logs | Structured Logs |
|--|--------------|----------------|
| Destino | Banco de dados | Console/Railway |
| Audiência | Usuários finais, auditoria | Desenvolvedores, ops |
| Imutável | ✅ Sim | ✗ Não |
| LGPD relevante | ✅ Sim | ✗ Não |
| Exemplo | "Usuário X aprovou documento Y" | "INFO import_session_created {sessionId:42}" |

## Correlação de Requests

```typescript
// Middleware gera correlationId por request
ctx.correlationId = nanoid();
ctx.requestId = nanoid();

// Propagado para todos os logs e activity_logs
log.info("operacao", { correlationId: ctx.correlationId });
await logActivity({ correlationId: ctx.correlationId, ... });
```

## Roadmap
- Sprint 5: Dashboard de métricas por organização
- Sprint 5: Alertas de prazo e anomalias
