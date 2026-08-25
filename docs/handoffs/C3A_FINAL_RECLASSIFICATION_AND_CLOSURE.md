# C.3A — Reclassificação do Target e Encerramento Formal (C.3A-CLOSE)

> **Somente documentação.** Nenhum runtime/router/schema/flag/CI alterado. `FF_DIRECT_CONTRACT_SHADOW`
> permanece **OFF**. C.3B **não** iniciada.

## 1. Contexto original da C.3A
Primeira migração supervisionada do [`../architecture/AI_LEGACY_MIGRATION_PLAN.md`](../architecture/AI_LEGACY_MIGRATION_PLAN.md):
rodar, **em shadow**, o Kernel canônico (`executeCognitiveTask({task:"DIRECT_PROCUREMENT_REASONING"})`) em
paralelo ao gerador legado de Contratação Direta, para medir equivalência antes de um eventual cutover —
sem efeito ao usuário e atrás de flag DB tenant-aware.

## 2. Implementação shadow realizada (PR C.3A)
- `directContractsRouter.generate.*` (após gerar+persistir o legado) dispara, **fire-and-forget**,
  `directContractShadowService.runDirectContractShadow` → `executeCognitiveTask(DIRECT_PROCUREMENT_REASONING)`.
- **Feature flag tenant-aware:** `FF_DIRECT_CONTRACT_SHADOW` (DB, default **OFF**/fail-closed).
- **Comparação estrutural determinística** (`compareDirectContractShadow`): `EQUIVALENT_STRUCTURE` ·
  `STRUCTURAL_DIVERGENCE` · `MISSING_REQUIRED_FIELD` · `CANONICAL_ERROR` · `LEGACY_ERROR` · `NOT_COMPARABLE`.
- **Replay safety:** `runWithIdempotency` (chave tenant+entidade+versão-efetiva do input; replay não duplica).
- **Observabilidade:** reusa `cognitive_observability` (hashes + metadados; sem chain-of-thought/conteúdo
  integral), recuperável por `correlationId`.
- **Isolamento multi-tenant:** flag/idempotência/observabilidade com `organizationId` explícito.
- **Legado permanece EFFECTIVE**; allowlists/`invokeLLM` intactos; nenhuma migration.
- **Status técnico: PASS** (validado por CI — replay/observabilidade/isolamento).

## 3. Achado da homologação — fluxo canônico × fluxo legado
Auditoria read-only (pós-homologação) confirmou no código e na navegação:

| | Oficial (canônico) | Legado-compat |
|---|---|---|
| Rota | **`/contratacao-direta`** (menu; RC-6, Business Domain) | `/direct-contracts*` (RC-2, **só URL direta**, fora do menu) |
| Página → router | `DirectProcurement` → `directProcurementRouter` | `DirectContracts` → `directContractsRouter` |
| Serviço | `directProcurementService` | `directContractDocuments` + `legalFrameworkAssistant` |
| IA | **Kernel** (`assertKernelAccess` + `orchestrateMultiCopilot`) | **`invokeLLM` legado** (efetivo) + `runDirectContractShadow` (shadow) |
| `directContractDocuments` no caminho? | **NÃO** | SIM |

- O serviço canônico **não** importa `invokeLLM`/`directContractDocuments` (confirmado).
- Único caller vivo de `directContractDocuments.generate*` é o router legado-compat; nenhum ponto da
  navegação oficial entra em `/direct-contracts` (links encontrados são auto-referências das próprias
  páginas legadas + rótulos de breadcrumb).

## 4. Classificação final = **C**
O fluxo institucional oficial **já migrou funcionalmente** para a infraestrutura canônica do Kernel. A
C.3A shadowa **exclusivamente** o fluxo legado-compat. Logo a C.3A é reclassificada como **observação /
retirada controlada de legado**, **não** migração de tráfego.

### Por que a homologação operacional completa do shadow legado é NÃO APLICÁVEL
O propósito original do shadow era informar um **cutover legado→Kernel** para a Contratação Direta. Esse
cutover é **moot** para o fluxo canônico: `/contratacao-direta` **já roda no Kernel**. O único código ainda
em `invokeLLM` (o gerador de `/direct-contracts`) é compat-only, sem tráfego operacional oficial — não há
o que "comutar".

## 5. Confirmações
- **Cutover NÃO executado / NÃO aplicável.**
- **Canônico já usa Kernel** (`orchestrateMultiCopilot`) — evidência em `directProcurementService.ts`.
- **`FF_DIRECT_CONTRACT_SHADOW` = OFF** (inalterado).
- **Legado preservado por compatibilidade** (remoção só após RC-5, per `LEGACY_INVENTORY.md`).

## 6. Critérios para futura retirada do legado (governada — não agora)
1. **Auditoria de callers reais** de `directContractsRouter`/`directContractDocuments`/`legalFrameworkAssistant`;
2. **Ausência de uso operacional** comprovada (nenhum tráfego além da URL compat);
3. **Equivalência funcional** quando aplicável;
4. **Rollback/rastreabilidade** (retirada reversível e auditável).
Nenhuma remoção nesta fase.

## 7. Correções operacionais reais descobertas na homologação (independentes da reclassificação)
Durante a homologação foram encontrados e corrigidos **bugs reais**, que permanecem **válidos e úteis**
independentemente do target da C.3A:
- **C.3A-OPS.2** — reconciliação de `activity_logs.processId` para nullable (migration `0294` idempotente
  + guarda de bootstrap + smoke de regressão). Destrava a auditoria governada organization-level.
- **C.3A-OPS.3** — serialização DATETIME no módulo de Contratação Direta (`server/db/directProcurement.ts`
  passou a usar `toDbDatetime`/`fromDbDatetime`; smoke MySQL em modo estrito). Corrige o HTTP 500 de
  `directProcurement.createProcess` no fluxo **canônico**.

Também governança operacional entregue: **C.3A-OPS** (controle institucional de feature flags) e
**C.3A-OPS.1** (superfície operacional de flags para platform admin).

## 8. Follow-up registrado (fora de escopo)
**DB safe error logging gap** — extrair `mysql2` `code`/`errno`/`sqlState`/coluna para log estruturado
seguro no boundary (sem SQL/params/segredos).

## 9. Status final
**C.3A — ENCERRADA / TARGET RECLASSIFIED.**
- implementação shadow: **PASS técnico**; replay/observabilidade/isolamento multi-tenant: **PASS**;
- homologação do fluxo institucional canônico via shadow C.3A: **NÃO APLICÁVEL** (canônico já usa Kernel);
- cutover: **NÃO APLICÁVEL / NÃO EXECUTADO**;
- legado: **preservado por compatibilidade**; remoção **futura / governada**;
- `FF_DIRECT_CONTRACT_SHADOW`: **OFF**;
- **C.3B: NÃO INICIADA.**
