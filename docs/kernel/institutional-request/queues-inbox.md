# Institutional Request Engine — Filas e Institutional Inbox

## Visão geral

Cada Business Domain possui uma **Institutional Inbox** (caixa de trabalho
institucional) alimentada pelo Engine. É por ela que o domínio destino recebe,
trabalha e responde às solicitações — sempre com **contexto automático** já anexado.

As solicitações são organizadas em **work queues** por estágio de trabalho, e o
roteamento interno é feito por `requestAssignment`. Notificações internas
(`requestNotification`) avisam os responsáveis.

## Work queues (por domínio)

A Institutional Inbox de cada domínio expõe quatro filas:

| Fila | Estados incluídos | Descrição |
|---|---|---|
| **Pendentes** | `PENDING`, `RECEIVED` | Solicitações recebidas aguardando início |
| **Em andamento** | `IN_PROGRESS`, `WAITING_INFORMATION` | Em análise ou aguardando informação |
| **Respondidos** | `COMPLETED`, `RETURNED` | Já respondidos e devolvidos à origem |
| **Finalizados** | `ARCHIVED` | Encerrados e arquivados |

```
┌──────────── Institutional Inbox — domínio Jurídico ────────────┐
│  Pendentes   │  Em andamento  │  Respondidos  │  Finalizados   │
│  ─────────   │  ────────────  │  ───────────  │  ───────────   │
│  #0142 PAR   │  #0138 REV     │  #0131 PAR    │  #0090 PAR     │
│  #0145 INFO  │  #0140 PAR     │  #0129 APR    │  #0088 REV     │
└────────────────────────────────────────────────────────────────┘
```

As filas são construídas a partir das procedures `listPending` e `listCompleted`,
sempre filtradas por organização (multi-tenant) e por domínio destino.

## Assignment (`requestAssignment`)

Cada solicitação recebida pode ser roteada internamente ao responsável correto via
`assignRequest`. O registro de assignment guarda:

| Campo | Descrição |
|---|---|
| `id` | Identificador SHA-256 determinístico |
| `organizationId` | Tenant |
| `requestId` | Solicitação atribuída |
| `assignedUser` | Usuário responsável |
| `assignedSector` | Setor responsável |
| `queue` | Fila interna do domínio |
| `priority` | Prioridade (baixa/média/alta/urgente) |
| `assignedBy` | Quem atribuiu |
| `createdAt` | Timestamp |

A atribuição não altera a máquina de estados por si só, mas normalmente acompanha a
transição `RECEIVED → IN_PROGRESS`, deixando claro **quem** trabalha a solicitação.

## Notificações internas (`requestNotification`)

O Engine gera **notificações internas** para avisar responsáveis sobre novos eventos
(solicitação recebida, informação pendente, resposta devolvida etc.).

| Campo | Descrição |
|---|---|
| `id` | Identificador SHA-256 determinístico |
| `organizationId` | Tenant |
| `requestId` | Solicitação relacionada |
| `channel` | Canal (`internal` implementado; `email`/`whatsapp` placeholders) |
| `recipient` | Destinatário (usuário/setor) |
| `event` | Evento que originou a notificação |
| `read` | Marcador de leitura |
| `createdAt` | Timestamp |

### Canais

- **Interno** — implementado nesta entrega (aparece na Inbox).
- **E-mail / WhatsApp** — **apenas placeholders**; a integração real é ponto de
  extensão futuro.

## Observabilidade das filas

A partir da timeline append-only e dos assignments, o Engine oferece métricas por
domínio e por organização:

- **Tempo de resposta** e **tempo médio** por solicitação.
- **Solicitações por domínio** (origem e destino).
- **Pendências** e **tamanho das filas**.
- **Gargalos** (onde as solicitações ficam mais tempo).
- **Produtividade** por usuário/setor.

## Princípios

- **Contexto sempre pronto**: o usuário do destino nunca procura documentos.
- **Multi-tenant**: filas e notificações restritas à organização.
- **Rastreável**: cada movimentação reflete na timeline append-only.
