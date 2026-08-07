# Encerramento Oficial — Fase C.1: Fundação de Governança Cognitiva e Documental

> Documento de **release/encerramento**. Registra o estado consolidado, evidências e limitações
> da Fase C.1. Handoff portável para a C.2: [`../handoffs/C2_GOVERNANCE_OPERATIONALIZATION_HANDOFF.md`](../handoffs/C2_GOVERNANCE_OPERATIONALIZATION_HANDOFF.md).

## 1. Identificação da fase

| Campo | Valor |
|---|---|
| Fase | **C.1 — Fundação de Governança Cognitiva e Documental** |
| PR | **#195** — *PR C.1 — Fundação de Governança Cognitiva e Documental* |
| Squash na `main` | `ae2f995ada092066098547a7c44dfafe625daa7e` |
| Branch de desenvolvimento | `claude/rebuild-licigov-pro-bFyTO` |
| SHA final da branch (pós-sync) | `1118b05c211c9aadc9885e41ee4fc247235148d8` |

## 2. Objetivo institucional

Estabelecer a **fundação** da governança das operações de IA, das aprovações institucionais, da
idempotência e da rastreabilidade ponta a ponta — de forma **aditiva e não-destrutiva**, reutilizando
os componentes canônicos existentes (Cognitive Kernel, serviço único de idempotência, RBAC), **sem
mecanismos paralelos**, sem migration e sem tocar produção congelada. O *wiring* operacional completo, a
interface de revisão/aprovação e a migração dos legados são explicitamente da fase **C.2**.

## 3. Escopo efetivamente entregue

- **Ledger de governança cognitiva** no Cognitive Kernel (`executeCognitiveTask`): cada execução grava,
  tenant-aware, um registro na observabilidade persistida (`cognitive_observability`, campo `payload`).
- **Persistência de** ator (`userId`), operação, módulo (business domain), `provider`, `model`,
  `promptTemplateId`+versão de contrato, **hashes SHA-256 de input/output**, pré-visualização governada
  *bounded*, referências de processo/documento, `reviewState` e **erro estruturado**.
- **Ausência de persistência de chain-of-thought** (apenas metadados institucionais, hashes e
  pré-visualização governada).
- **Idempotência canônica reforçada contra concorrência**: o caminho "new" captura a violação do
  `UNIQUE idempotency_org_user_key` e relê a linha vencedora (sem 500 cru, sem linha duplicada).
- **Wrapper `runWithIdempotency`** (replay seguro / conflito explícito / operação em andamento /
  falha não cacheada como sucesso) — reutiliza o serviço único; **não** é um segundo mecanismo.
- **Segregação de deveres no state machine canônico** (`documentWorkflowService.applyTransition` via
  `assertInstitutionalDecisionRules`): **reviewer ≠ autor**.
- **Impedimento de aprovação por IA/sistema** (aprovação exige revisor humano identificado).
- **Justificativa obrigatória** para rejeição/devolução.
- **Contrato CATMAT/CATSER fail-closed** (`assessMatchSafety`): `no_candidates` / `below_threshold` /
  `threshold_not_configured`; nunca declara seguro sem limiar institucional explícito; **nunca fabrica
  código**.
- **Ausência de limiar arbitrário** (o antigo default foi removido).
- **Provenance/`source`** nas sugestões CATMAT/CATSER.
- **`correlationId` confirmado** no fluxo canônico (cliente → tRPC → gateway → persistência).
- **Documentação arquitetural** da governança: [`../architecture/COGNITIVE_GOVERNANCE.md`](../architecture/COGNITIVE_GOVERNANCE.md).

## 4. Decisões arquiteturais

- **Gateway canônico é o Cognitive Kernel** (`executeCognitiveTask`), **não** `server/_core/llm.ts`.
  `invokeLLM`/Gemini-raw permanecem **fronteira legada allowlistada** em
  `server/kernel/architecture/legacyBoundaries.ts`, enforçada por boundary-tests (`rc352`, `rc41`).
  Divergência entre o enunciado histórico (que citava `llm.ts`) e o código foi resolvida a favor do
  código (verdade operacional) e registrada.
- **Sem migration**: reutilizou-se o campo `payload` de `cognitive_observability` e o `UNIQUE`
  tenant-aware de `idempotency_keys`, conforme "migration aditiva mínima somente se necessária".
- **SoD aplicada no canônico**, não no fluxo legado ativo da UI (`documentsRouter`), que é
  `LEGACY_ACTIVE_MAINTENANCE_ONLY` (produção) e não pode ser alterado nesta fase.
- **Regras puras e testáveis** (`assertInstitutionalDecisionRules`, `assessMatchSafety`) extraídas para
  permitir verificação sem banco.

## 5. Evidências de CI, merge e produção

- **CI da `main`** (evento push no squash): **run `31145264496` — 6/6 jobs SUCCESS**:
  Typecheck + Lint · Testes Automatizados · Smoke MySQL + Isolamento · Build de Produção ·
  Auditoria de Dependências · Deploy (Preparação).
- **Smoke específico**: *Smoke — idempotência canônica (PR C)* — **SUCCESS**.
- **Merge**: squash `ae2f995` na `main`; branch de desenvolvimento sincronizada por **merge normal e
  não-destrutivo** (`--no-ff`), **apenas topológico** (zero mudança de arquivo), `origin/main` é
  ancestral da branch, working tree limpa, branch local e remota sincronizadas, **Graphify não
  regenerado** nessa sincronização.
- **Produção** (conforme apresentado pelo operador): domínio `licigovpro.com.br`, branch `main`,
  deployment da PR C.1 com estado **Deployment successful / Active**.
  > Nota: nenhuma verificação adicional de `/readyz` ou de logs internos foi materialmente acessível a
  > este ambiente (proxy nega Railway; MCP Railway offline). Não são afirmadas evidências além do estado
  > acima informado pelo operador.

## 6. Limitações conhecidas

- Idempotência reforçada, porém **ligada apenas a ingestão/promoção** (demais operações → C.2).
- SoD implementada no state machine canônico, porém o **fluxo legado usado pela UI** permanece.
- Contrato CATMAT fail-closed pronto, porém **confirmação operacional/UI e limiar institucional
  pendentes**.
- Ledger cognitivo grava no `payload` (JSON) — governança consultável por `correlationId`; **não** foram
  criadas colunas dedicadas/indexadas (decisão de minimizar risco; reavaliar em C.2 se necessário).

## 7. Itens expressamente NÃO implementados

- Nenhuma **migration** foi criada.
- Nenhuma **chamada legada de IA** foi migrada ao gateway.
- O **wiring completo da idempotência** (geração/regeneração/exportação/upload/aprovação/CATMAT) **não**
  foi realizado.
- O **fluxo legado usado pela UI** (`documentsRouter`) **não** foi substituído.
- A **interface operacional** de revisão/aprovação/solicitação de ajustes **não** foi criada.
- A **confirmação humana completa** de CATMAT/CATSER (ator/timestamp/processo/item/rejeição/substituição)
  **não** foi implementada.
- O **limiar institucional** CATMAT/CATSER **não** foi definido (fail-closed até então).

## 8. Riscos residuais

- **Dupla governança de CATMAT**: coexistem o fluxo LLM legado (usado pela UI) e o determinístico
  (`catmatMatching`) — a consolidação plena é da C.2; risco de divergência de comportamento até lá.
- **Idempotência parcial**: operações ainda não cobertas podem duplicar efeito sob retry até o wiring da
  C.2.
- **SoD não aplicada no caminho legado da UI**: aprovações via `documentsRouter` seguem a regra antiga
  (owner-only) até a C.2.
- **Legados de IA ativos**: `services/gemini.ts` e afins seguem em produção sem passar pelo ledger de
  governança até a migração supervisionada (C.2).

## 9. Critérios de aceite atendidos

- [x] Fundação aditiva e não-destrutiva, sem migration, sem tocar produção congelada.
- [x] Gateway canônico grava ledger de governança tenant-aware, sem chain-of-thought.
- [x] Idempotência única reforçada (concorrência-safe) + wrapper reutilizável.
- [x] SoD (reviewer ≠ autor, sem auto-aprovação de IA, justificativa obrigatória) no state machine
      canônico.
- [x] CATMAT fail-closed, sem limiar arbitrário, com provenance.
- [x] `correlationId` ponta a ponta confirmado.
- [x] Gates locais e CI da `main` verdes (6/6).
- [x] Escopo pendente reclassificado e handoff da C.2 produzido.

## 10. Declaração formal

**CHECKPOINT PÓS-PR C.1: PASS**
