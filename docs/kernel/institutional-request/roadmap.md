# Institutional Request Engine — Roadmap

## Entrega desta sprint

Esta sprint entrega o **núcleo do Institutional Request Engine** como componente do
Kernel (`institutional_request_engine`), permitindo troca institucional de
solicitações entre Business Domains **sem acoplamento** e **sem duplicação de
documentos**.

### Escopo entregue

- **Kernel Service** `institutional_request_engine` registrado e acessível via
  `kernelAccessService`.
- **API única de integração**: `requestInstitutionalReview()` — usada por todos os
  domínios, exatamente com a mesma assinatura.
- **Domain model** completo: `institutionalRequest`, `institutionalResponse`,
  `requestTimeline` (append-only), `requestAssignment`, `requestNotification`,
  `documentReference` (documentos sempre por referência).
- **Request types**: LEGAL_OPINION_INITIAL, LEGAL_OPINION_FINAL, CONTROL_REVIEW,
  TECHNICAL_REVIEW, DOCUMENT_REVIEW, APPROVAL, SIGNATURE, INFORMATION_REQUEST,
  CORRECTION_REQUEST.
- **Máquina de estados**: NEW → PENDING → RECEIVED → IN_PROGRESS →
  WAITING_INFORMATION → COMPLETED → RETURNED → ARCHIVED.
- **Contexto automático**: processo, documentos, timeline, histórico, contexto,
  reasoning, explainability, recomendações e riscos entregues ao destino.
- **Institutional Inbox** por domínio com filas Pendentes → Em andamento →
  Respondidos → Finalizados.
- **`institutionalRequestRouter`** com: `createRequest`, `assignRequest`,
  `receiveRequest`, `listPending`, `listCompleted`, `respond`, `returnRequest`,
  `archive`, `getTimeline`.
- **6 tabelas MySQL** (Drizzle/Railway): `institutional_requests`,
  `institutional_responses`, `request_assignments`, `request_timelines`,
  `request_notifications`, `document_references`.
- **Garantias**: multi-tenant estrito (jamais entre organizações), replay safety
  (IDs SHA-256 determinísticos, snapshots, correlation IDs, lineage) e
  observabilidade (tempo de resposta, tempo médio, solicitações por domínio,
  pendências, filas, gargalos, produtividade).
- **Assinatura**: apenas infraestrutura/placeholders (manual, ICP-Brasil, GOV.BR,
  certificado A1) — **sem assinatura real**.

## Primeiro consumidor: Parecer Jurídico

O Engine será usado **inicialmente pelo módulo Parecer Jurídico**, no fluxo canônico:

```
Processo Licitatório → LEGAL_OPINION_INITIAL → domínio Jurídico
                    → Parecer → retorno automático → Processo Licitatório
```

Esse caso valida ponta a ponta a API única, o contexto automático, a máquina de
estados, a Institutional Inbox e o retorno automático — servindo de referência para
os demais domínios (Controle, Técnico, Aprovação).

## Pontos de extensão futuros (NÃO implementados)

As evoluções abaixo já têm lugar reservado na arquitetura, mas **não fazem parte
desta entrega**:

| Extensão | Observação |
|---|---|
| **Assinatura ICP-Brasil / GOV.BR** | Hoje apenas placeholders em `signatureInfo` |
| **Distribuição automática** | Roteamento automático de solicitações às filas |
| **SLA** | Prazos, medição e alertas de descumprimento |
| **Filas inteligentes** | Priorização e balanceamento assistidos por IA |
| **E-mail / WhatsApp** | Canais externos de `requestNotification` |
| **Calendário** | Integração com agenda e prazos |
| **Lembretes** | Alertas recorrentes de pendências |
| **Delegação** | Repasse de responsabilidade entre usuários/setores |
| **SEI** | Integração com Sistema Eletrônico de Informações |
| **Protocolo** | Numeração/protocolo institucional externo |
| **Workflow entre órgãos** | Troca de solicitações entre órgãos distintos |

## Princípios preservados na evolução

- Domínios **nunca conversam entre si** — sempre via Engine.
- Documentos **nunca copiados** — sempre `documentReference`.
- **Multi-tenant** estrito — jamais comunicação entre organizações.
- Toda evolução mantém a **API única** `requestInstitutionalReview()`.
