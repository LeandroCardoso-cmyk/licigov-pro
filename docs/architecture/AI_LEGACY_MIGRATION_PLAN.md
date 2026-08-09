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
| `server/services/directContractDocuments.ts` | `directContractsRouter.ts` | Consumidor **NÃO congelado** | `DIRECT_PROCUREMENT_REASONING` | **Alta** — produção ativa; alvo prioritário de shadow |
| `server/services/legalFrameworkAssistant.ts` | `directContractsRouter.ts` | Consumidor **NÃO congelado** | `LEGAL_ANALYSIS` | **Alta** — produção ativa |
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

1. **`directContractDocuments.ts` → `DIRECT_PROCUREMENT_REASONING`** (maior valor: consumidor não
   congelado, produção ativa). Shadow em `directContractsRouter`, comparação de saída, flag de cutover.
2. **`legalFrameworkAssistant.ts` → `LEGAL_ANALYSIS`** (mesmo consumidor).
3. **`legalOpinionService.ts` → `LEGAL_ANALYSIS`** (consumidor congelado — exige descongelamento
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
