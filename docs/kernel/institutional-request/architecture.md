# Institutional Request Engine — Arquitetura

## Visão geral

O **Institutional Request Engine** é um **componente do Kernel** (Cognitive Kernel)
do LiciGov Pro. Ele **não pertence a nenhum Business Domain** — é registrado como
Kernel Service sob o identificador `institutional_request_engine` e fica disponível
transversalmente para todos os domínios da plataforma.

Seu objetivo é permitir que **Business Domains troquem solicitações institucionais
sem acoplamento direto**. Os domínios **não conversam entre si**: toda comunicação
institucional passa obrigatoriamente pelo Engine.

> Definição: "Camada institucional de troca de solicitações entre domínios,
> operando dentro do Kernel, sem acoplamento e sem duplicação de documentos."

## Por que é Kernel (e não um domínio)

Se cada Business Domain chamasse diretamente outro domínio, teríamos:

- **Acoplamento direto** — o Processo Licitatório precisaria conhecer a API interna
  do Jurídico, do Controle, do Técnico etc.
- **Explosão de integrações** — N domínios geram N×(N-1) integrações ponto a ponto.
- **Duplicação de documentos** — cada troca copiaria arquivos entre módulos.
- **Perda de rastreabilidade** — histórico espalhado entre domínios.

Colocar a troca institucional **no Kernel** resolve isso:

- Existe **um único ponto de integração** (`requestInstitutionalReview()`).
- Os domínios ficam **desacoplados**: origem e destino nunca se referenciam.
- Documentos **nunca são copiados** — apenas referenciados (`documentReference`).
- Toda a comunicação é **auditável e append-only** no Kernel.

```
        Business Domain A ──┐
        Business Domain B ──┤   (nenhum domínio fala com outro)
        Business Domain C ──┤
                            ▼
        ┌──────────────────────────────────────────┐
        │   KERNEL — institutional_request_engine   │
        │   requestInstitutionalReview()            │
        └──────────────────────────────────────────┘
                            ▲
        Business Domain D ──┘
```

## Fluxo institucional

```
Business Domain (origem)
        │  abre Institutional Request
        ▼
Institutional Request Engine (Kernel)
        │  entrega contexto automático
        ▼
Business Domain (destino)
        │  produz Institutional Response
        ▼
Institutional Request Engine (Kernel)
        │  retorna automaticamente
        ▼
Business Domain (origem)   ← resposta chega sem download/upload/duplicação
```

Exemplo canônico:

`Processo Licitatório` → `Solicitação de Parecer Inicial` → domínio `Jurídico`
→ `Parecer assinado` → retorna **automaticamente** ao `Processo Licitatório`.

## Camadas

| Camada | Responsabilidade | Tecnologia |
|---|---|---|
| **API de integração** | Ponto único `requestInstitutionalReview()` | tRPC 11 |
| **Router** | `institutionalRequestRouter` (procedures) | tRPC 11 |
| **Domínio do Engine** | request, response, timeline, assignment, notification, documentReference | TypeScript |
| **Persistência** | 6 tabelas MySQL | Drizzle ORM (Railway) |
| **Kernel Services** | registro e acesso controlado | `kernelAccessService` |
| **Apresentação** | Institutional Inbox por domínio | React 19 |

## Relação com o `kernelAccessService`

O Engine é um **Kernel Service** e, portanto, é registrado e acessado através do
`kernelAccessService`:

- **Registro**: `institutional_request_engine` é publicado no catálogo de serviços
  do Kernel.
- **Controle de acesso**: qualquer Business Domain que queira abrir uma solicitação
  obtém o Engine via `kernelAccessService`, respeitando escopo e permissões.
- **Isolamento multi-tenant**: o `kernelAccessService` garante que toda operação
  ocorra dentro da organização (tenant) do chamador. **Jamais** há comunicação entre
  organizações diferentes.

## Garantias arquiteturais

- **Desacoplamento total** entre domínios de negócio.
- **Documentos por referência**, nunca por cópia (`documentReference`).
- **Contexto automático**: o destino recebe processo, documentos, timeline,
  histórico, reasoning, explainability, recomendações e riscos sem esforço manual.
- **Rastreabilidade**: timeline append-only, correlation IDs e lineage.
- **Replay safety**: IDs SHA-256 determinísticos e snapshots imutáveis.
- **Multi-tenant**: todo request pertence a uma organização.

## Documentos relacionados

- `request-model.md` — modelo de dados (request/response/documentReference).
- `status-machine.md` — máquina de estados e timeline.
- `integration-api.md` — a API única `requestInstitutionalReview()`.
- `queues-inbox.md` — Institutional Inbox e assignment.
- `roadmap.md` — entrega da sprint e pontos de extensão.
