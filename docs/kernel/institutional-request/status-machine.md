# Institutional Request Engine — Máquina de Estados

## Visão geral

Toda `institutionalRequest` evolui por uma **máquina de estados** determinística. Cada
transição é registrada na `requestTimeline`, que é **append-only** (nunca sofre
update ou delete). Isso garante rastreabilidade total e replay safety.

## Estados

```
NEW → PENDING → RECEIVED → IN_PROGRESS → WAITING_INFORMATION → COMPLETED → RETURNED → ARCHIVED
```

| Estado | Significado |
|---|---|
| `NEW` | Solicitação criada, ainda não publicada para o destino |
| `PENDING` | Publicada e aguardando o domínio destino recebê-la |
| `RECEIVED` | Domínio destino acusou recebimento (entrou na Inbox) |
| `IN_PROGRESS` | Em análise/execução pelo destino |
| `WAITING_INFORMATION` | Destino aguarda informação/correção da origem |
| `COMPLETED` | Resposta institucional produzida |
| `RETURNED` | Resposta devolvida automaticamente à origem |
| `ARCHIVED` | Encerrada e arquivada |

## Transições válidas

| De | Para | Gatilho (procedure) |
|---|---|---|
| `NEW` | `PENDING` | `createRequest` publica ao destino |
| `PENDING` | `RECEIVED` | `receiveRequest` |
| `RECEIVED` | `IN_PROGRESS` | `assignRequest` / início da análise |
| `IN_PROGRESS` | `WAITING_INFORMATION` | destino pede informação (`INFORMATION_REQUEST`) |
| `WAITING_INFORMATION` | `IN_PROGRESS` | origem responde à pendência |
| `IN_PROGRESS` | `COMPLETED` | `respond` |
| `COMPLETED` | `RETURNED` | `returnRequest` (retorno automático) |
| `RETURNED` | `ARCHIVED` | `archive` |

Transições **não listadas são inválidas** e devem ser rejeitadas pelo router antes
de qualquer escrita no banco.

```
 NEW
  │ createRequest
  ▼
 PENDING
  │ receiveRequest
  ▼
 RECEIVED
  │ assignRequest / início
  ▼
 IN_PROGRESS ◀────────────┐
  │ respond               │ origem responde
  │                       │
  ├── WAITING_INFORMATION ┘
  ▼
 COMPLETED
  │ returnRequest (automático)
  ▼
 RETURNED
  │ archive
  ▼
 ARCHIVED
```

## Regras de transição

- **Sequencial e explícita**: cada transição corresponde a uma procedure do
  `institutionalRequestRouter`.
- **Idempotência / replay safety**: repetir a mesma transição não gera efeitos
  duplicados; os IDs SHA-256 determinísticos evitam duplicação.
- **Multi-tenant**: só é possível transicionar requests da própria organização.
- **Retorno automático**: `COMPLETED → RETURNED` é disparado pelo Engine, entregando
  a resposta à origem **sem download nem upload**.

## Timeline append-only (`requestTimeline`)

Cada mudança de estado (e cada evento relevante) gera um registro imutável.

| Campo | Descrição |
|---|---|
| `id` | Identificador SHA-256 determinístico |
| `organizationId` | Tenant |
| `requestId` | Solicitação relacionada |
| `fromStatus` | Estado anterior (nulo em `NEW`) |
| `toStatus` | Novo estado |
| `event` | Descrição do evento |
| `actor` | Usuário/serviço/domínio responsável |
| `correlationId` | Correlação para lineage |
| `createdAt` | Timestamp do evento |

### Propriedades

- **Append-only**: apenas inserts. Nunca update ou delete.
- **Fonte de verdade da rastreabilidade**: reconstrói a história completa.
- **Lineage**: `correlationId` liga eventos ao longo do ciclo de vida.
- **Observabilidade**: alimenta métricas de tempo de resposta, tempo médio,
  pendências, gargalos e produtividade.

## Consulta

A procedure `getTimeline` retorna a linha do tempo completa de uma solicitação,
ordenada por `createdAt`, respeitando o isolamento multi-tenant.
