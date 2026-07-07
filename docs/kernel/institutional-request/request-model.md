# Institutional Request Engine — Modelo de Dados

## Visão geral

O domínio do Engine é composto por seis entidades. Todas pertencem ao **Kernel** e
carregam sempre o vínculo de **organização (tenant)**. Este documento descreve as
três centrais para a troca de solicitações:

- `institutionalRequest` — a solicitação institucional.
- `institutionalResponse` — a resposta do domínio destino.
- `documentReference` — referência (nunca cópia) a documentos.

As demais (`requestTimeline`, `requestAssignment`, `requestNotification`) são
detalhadas em `status-machine.md` e `queues-inbox.md`.

## Entidades e tabelas

| Entidade | Tabela MySQL |
|---|---|
| `institutionalRequest` | `institutional_requests` |
| `institutionalResponse` | `institutional_responses` |
| `requestAssignment` | `request_assignments` |
| `requestTimeline` | `request_timelines` |
| `requestNotification` | `request_notifications` |
| `documentReference` | `document_references` |

## `institutionalRequest`

Representa uma solicitação aberta por um Business Domain de origem para um Business
Domain de destino.

| Campo | Descrição |
|---|---|
| `id` | Identificador SHA-256 determinístico (replay safe) |
| `organizationId` | Tenant dono da solicitação (obrigatório) |
| `originDomain` | Business Domain de origem (ex.: `licitacao`) |
| `targetDomain` | Business Domain de destino (ex.: `juridico`) |
| `requestType` | Tipo da solicitação (ver tabela abaixo) |
| `processId` | Processo licitatório vinculado |
| `status` | Estado atual (`NEW`…`ARCHIVED`) |
| `priority` | Prioridade (baixa/média/alta/urgente) |
| `context` | Contexto automático (reasoning, explainability, riscos, recomendações) |
| `correlationId` | ID de correlação para lineage |
| `createdBy` | Usuário/serviço que abriu |
| `createdAt` / `updatedAt` | Timestamps |

O campo `context` transporta o **contexto automático** entregue ao destino: dados do
processo, timeline, histórico, reasoning, explainability, recomendações e riscos.
Assim, o domínio destino **nunca precisa procurar documentos**.

## `institutionalResponse`

Representa a resposta produzida pelo domínio destino e devolvida automaticamente à
origem.

| Campo | Descrição |
|---|---|
| `id` | Identificador SHA-256 determinístico |
| `requestId` | FK para `institutional_requests` |
| `organizationId` | Tenant (herdado da solicitação) |
| `respondingDomain` | Domínio que respondeu (destino) |
| `outcome` | Resultado (ex.: favorável, desfavorável, com ressalvas) |
| `responseType` | Natureza da resposta (parecer, revisão, aprovação…) |
| `content` | Conteúdo estruturado da resposta |
| `documentReferences` | Documentos anexados **por referência** |
| `signatureInfo` | Placeholder de assinatura (ver abaixo) |
| `respondedBy` | Usuário/setor responsável |
| `createdAt` | Timestamp |

### Assinatura (apenas infraestrutura)

O campo `signatureInfo` guarda **apenas placeholders** de assinatura: modo
`manual`, `ICP-Brasil`, `GOV.BR` ou `certificado A1`. **Nenhuma assinatura real é
implementada nesta entrega** — é ponto de extensão futuro.

## `documentReference`

Documentos **nunca são copiados** entre domínios. Toda troca usa referências.

| Campo | Descrição |
|---|---|
| `id` | Identificador SHA-256 determinístico |
| `organizationId` | Tenant |
| `sourceDomain` | Domínio de origem do documento |
| `documentId` | Identificador do documento referenciado |
| `version` | Versão referenciada do documento |
| `snapshot` | Snapshot imutável (replay safety / lineage) |
| `linkedRequestId` | Solicitação ou resposta que referencia |
| `createdAt` | Timestamp |

O `snapshot` garante que a referência aponte para o **estado exato** do documento no
momento da troca, mesmo que a versão viva evolua depois.

## Request types

O `requestType` define a natureza institucional da solicitação:

| Tipo | Uso |
|---|---|
| `LEGAL_OPINION_INITIAL` | Parecer jurídico inicial |
| `LEGAL_OPINION_FINAL` | Parecer jurídico final / adjudicação |
| `CONTROL_REVIEW` | Revisão de controle interno |
| `TECHNICAL_REVIEW` | Revisão técnica |
| `DOCUMENT_REVIEW` | Revisão documental |
| `APPROVAL` | Aprovação institucional |
| `SIGNATURE` | Solicitação de assinatura (placeholder) |
| `INFORMATION_REQUEST` | Pedido de informação |
| `CORRECTION_REQUEST` | Pedido de correção |

## Princípios do modelo

- **Sem cópia de documentos** — sempre `documentReference`.
- **Multi-tenant** — `organizationId` obrigatório em todas as entidades.
- **Replay safe** — IDs SHA-256 determinísticos e snapshots.
- **Rastreável** — `correlationId` e lineage ligam request → response → documentos.
