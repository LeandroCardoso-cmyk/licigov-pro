# Plano de Migração da IA Legada → Kernel Cognitivo Canônico

> **Status:** PLANO + inventário. **Nenhum cutover, nenhuma remoção, nenhuma reescrita**
> é executada nesta PR (C.2A). Este documento é o mapa auditável para migrações FUTURAS,
> cada uma sob autorização própria. A regra de ouro permanece: adicionar/remover um caminho
> de allowlist é decisão arquitetural explícita — nunca um atalho.
>
> Fonte da verdade das fronteiras: [`server/kernel/architecture/legacyBoundaries.ts`](../../server/kernel/architecture/legacyBoundaries.ts).
> Testes que travam o build: `rc352-boundary-enforcement.test.ts`, `rc41-cognitive-activation.test.ts`.

## 1. Princípio de migração (não-negociável)

1. **Equivalência provada antes de cutover.** Nenhuma função legada é desligada sem que o
   caminho canônico (`executeCognitiveTask`) produza resultado equivalente, validado em
   staging, com observabilidade e idempotência.
2. **Shadow-first.** A rota canônica roda em paralelo (shadow), sem efeito colateral no
   usuário, até a equivalência ser demonstrada. Só então o tráfego é comutado, atrás de flag.
3. **Rollback trivial.** Toda comutação é reversível por flag/env — sem migração de dados
   destrutiva, sem apagar o legado no mesmo passo.
4. **Fronteira preservada.** `invokeLLM` permanece EXCLUSIVO do código legado allowlistado.
   Nenhum componente novo usa `invokeLLM`; a cognição nova passa por `executeCognitiveTask`.

## 2. Inventário da IA legada (via `INVOKE_LLM_LEGACY_ALLOWLIST`)

| Serviço legado | Consumidor(es) atual(is) | Situação de fronteira | Task canônica alvo | Criticidade |
|---|---|---|---|---|
| `server/services/catmatMatcher.ts` | `processesRouter.ts` | Consumidor **congelado** (`LEGACY_ACTIVE_MAINTENANCE_ONLY`) | `CATMAT_MATCHING` | **Pode FABRICAR código** — de facto inalcançável no fluxo ativo (o painel usa `itemIntelligenceRouter` determinístico) |
| `server/services/directContractDocuments.ts` | `directContractsRouter.ts` (`/direct-contracts*`) | **LEGADO-COMPAT** (acesso por URL direta; fora da navegação oficial) | `DIRECT_PROCUREMENT_REASONING` | **Reclassificado (C.3A-CLOSE)** — NÃO é produção ativa. O fluxo oficial `/contratacao-direta` já usa o Kernel (`orchestrateMultiCopilot`) e **não** chama este serviço. Shadow C.3A = observação de legado, sem cutover |
| `server/services/legalFrameworkAssistant.ts` | `directContractsRouter.ts` (`/direct-contracts*`) | **LEGADO-COMPAT** (acesso por URL direta) | `LEGAL_ANALYSIS` | **Reclassificado (C.3A-CLOSE)** — mesmo fluxo legado-compat; não é produção ativa |
| `server/services/legalOpinionService.ts` | `legalOpinionsRouter.ts` | Consumidor **congelado** (`LEGACY_ACTIVE_MAINTENANCE_ONLY`) | `LEGAL_ANALYSIS` / reasoning | Média — legado ativo em `/parecer-juridico/*` (compat) |
| `server/services/examples/legalValidationExample.ts` | — (exemplo) | Disposição `remocao_futura` | — | Baixa — remover em limpeza, não migrar |

**Também no pipeline documental legado ativo** (via `AI_SDK_ALLOWLIST` + `LEGACY_ACTIVE_MAINTENANCE_ONLY`):
`server/services/gemini.ts` (geração de DFD/ETP/TR/Edital via `documentsRouter`). Congelado — sem
migração nesta fase.

### Tabelas órfãs detectadas (não migrar; candidatas a limpeza futura)

- `ai_execution_audits` e `provider_executions`: **zero writers** em serviços (apenas DDL em
  `bootstrap.ts`). Não são escritas por nenhum caminho vivo. Nenhuma ação nesta PR — registradas
  aqui para decisão futura de remoção (migração `DROP` exige autorização e verificação de que
  staging/produção também não têm dependentes).

## 3. Task types canônicos já existentes

`server/domain/cognitiveTask.ts` já define `LEGAL_ANALYSIS`, `DIRECT_PROCUREMENT_REASONING`,
`CATMAT_MATCHING`, `PROCUREMENT_REASONING`, `GENERATE_DOCUMENT`, `COMPLIANCE_CHECK`,
`CONTRACT_REASONING`. **Porém nenhum router vivo roteia as funções legadas por
`executeCognitiveTask`** — o contrato existe, o wiring não. Este é o trabalho de cada migração
futura (uma por serviço), não desta PR.

## 4. Sequência de migração recomendada (futuras PRs, cada uma isolada)

> **Reordenado em C.3A-CLOSE.** `directContractDocuments.ts` **não** é mais o primeiro alvo de tráfego
> ativo: seu único consumidor vivo é o router legado-compat `/direct-contracts*` (fora da navegação
> oficial), e o fluxo institucional atual (`/contratacao-direta`) **já** roda sobre o Kernel. Não há
> cutover pendente para o fluxo canônico. Qualquer retirada do legado exige auditoria de callers +
> critérios formais (ver §5.1 e o handoff de encerramento da C.3A).

1. **`directContractDocuments.ts` / `legalFrameworkAssistant.ts`** — **NÃO migrar tráfego.** Consumidor
   é o legado-compat `/direct-contracts*` (acesso por URL direta). O shadow C.3A (`DIRECT_PROCUREMENT_REASONING`)
   permanece como **observação de retirada de legado**, sem flag de cutover. Retirada futura sob
   autorização, após auditoria de callers e ausência de uso operacional.
2. **`legalOpinionService.ts` → `LEGAL_ANALYSIS`** (consumidor congelado — exige descongelamento
   autorizado antes; **PARAR e reportar** se for necessário mexer em `LEGACY_ACTIVE_MAINTENANCE_ONLY`).
4. **`catmatMatcher.ts`**: NÃO migrar tráfego — está inalcançável e pode fabricar código. Candidato a
   **remoção** após confirmação de zero callers vivos (o fluxo ativo já é o `itemIntelligenceRouter`
   determinístico + a governança supervisionada desta PR C.2). Remoção exige autorização.
5. **Limpeza**: `examples/legalValidationExample.ts` e tabelas órfãs — remoção sob autorização.

## 5. Protocolo de shadow (infra a construir na PR de cada migração)

- Um wrapper de comparação executa legado (efetivo) e canônico (shadow), registra divergência em
  observabilidade (sem chain-of-thought, sem conteúdo sensível integral), **sem** alterar a resposta
  ao usuário.
- Critério de equivalência: N execuções de staging com divergência estrutural nula (campos
  obrigatórios) e divergência textual dentro de tolerância revisada por humano.
- Só após o critério, uma flag comuta o tráfego. Rollback = desligar a flag.

## 5.1 Estado de execução — C.3A (shadow de `directContractDocuments`)

**Implementado (PR C.3A) — SHADOW apenas, sem cutover.** O item §4.1 tem agora a infraestrutura de
shadow construída: `directContractsRouter.generate.*` dispara, fire-and-forget, o
`directContractShadowService` → `executeCognitiveTask({task:"DIRECT_PROCUREMENT_REASONING"})`, atrás da
flag DB tenant-aware **`FF_DIRECT_CONTRACT_SHADOW`** (default OFF/fail-closed). Comparação estrutural
determinística (`compareDirectContractShadow`, classes `EQUIVALENT_STRUCTURE`/`STRUCTURAL_DIVERGENCE`/
`MISSING_REQUIRED_FIELD`/`CANONICAL_ERROR`/`LEGACY_ERROR`/`NOT_COMPARABLE`), idempotência via
`runWithIdempotency`, observabilidade reusando `cognitive_observability` (sem chain-of-thought/conteúdo
integral). **Legado permanece EFFECTIVE**; allowlists e `invokeLLM` intactos; nenhuma migration.
Detalhes e procedimento de homologação: [`../handoffs/C3A_DIRECT_CONTRACT_SHADOW_DELIVERY.md`](../handoffs/C3A_DIRECT_CONTRACT_SHADOW_DELIVERY.md).
**Cutover NÃO realizado** — depende de dados reais de staging (critério/flag de cutover futuros).

### 5.2 Encerramento e reclassificação — C.3A-CLOSE

Auditoria operacional read-only (pós-homologação) determinou que o **alvo do shadow C.3A é um fluxo
legado-compat**, não o fluxo institucional canônico:

- **Oficial:** `/contratacao-direta` → `DirectProcurement` → `directProcurementRouter` →
  `directProcurementService` → **Kernel** (`assertKernelAccess` + `orchestrateMultiCopilot`). Este serviço
  **não** importa `invokeLLM` nem `directContractDocuments`.
- **Legado-compat:** `/direct-contracts*` → `directContractsRouter.generate.*` → `directContractDocuments`
  (`invokeLLM`, efetivo) + `fireDirectContractShadow`. Fora da navegação oficial (RC-2); acesso só por URL
  direta; substituído por `/contratacao-direta` (RC-6 / `LEGACY_INVENTORY.md`).

**Classificação final = C.** O fluxo canônico **já migrou** para infraestrutura do Kernel; não há tráfego
canônico em `/direct-contracts` a migrar. Portanto:

1. A implementação shadow permanece **tecnicamente válida e validada por CI** (replay/observabilidade/
   isolamento multi-tenant PASS), mas **não é base para decisão de cutover** do fluxo institucional.
2. **Homologação operacional completa do shadow legado = NÃO APLICÁVEL** ao fluxo canônico.
3. **Cutover NÃO APLICÁVEL / NÃO EXECUTADO.** `FF_DIRECT_CONTRACT_SHADOW` permanece **OFF**.
4. O legado é **preservado por compatibilidade** (remoção só após RC-5, per `LEGACY_INVENTORY.md`).
5. **Retirada futura governada:** exige auditoria de callers reais + ausência de uso operacional +
   equivalência funcional (quando aplicável) + rollback/rastreabilidade. **Nenhuma remoção agora.**

Handoff de encerramento: [`../handoffs/C3A_FINAL_RECLASSIFICATION_AND_CLOSURE.md`](../handoffs/C3A_FINAL_RECLASSIFICATION_AND_CLOSURE.md).

## 6. O que esta PR (C.2A) NÃO faz

- Não altera `INVOKE_LLM_LEGACY_ALLOWLIST` nem qualquer allowlist de fronteira.
- Não liga nenhuma função legada a `executeCognitiveTask`.
- Não remove nenhum serviço legado nem tabela órfã.
- Não descongela nada em `LEGACY_ACTIVE_MAINTENANCE_ONLY`.

## 7. Condições de PARADA (reportar, não prosseguir)

- Necessidade de alterar `LEGACY_ACTIVE_MAINTENANCE_ONLY` para migrar um consumidor congelado.
- Qualquer remoção de legado sem equivalência provada.
- Migração de dados destrutiva (ex.: `DROP` das tabelas órfãs) sem verificação de produção/staging.
- Divergência de contrato incompatível entre legado e canônico que exija decisão de produto.
