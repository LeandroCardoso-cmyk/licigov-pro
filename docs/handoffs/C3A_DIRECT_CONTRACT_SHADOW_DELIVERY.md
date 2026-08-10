# C.3A — Shadow Migration da Contratação Direta para o Kernel Cognitivo (entrega)

> Primeira migração supervisionada do plano [`../architecture/AI_LEGACY_MIGRATION_PLAN.md`](../architecture/AI_LEGACY_MIGRATION_PLAN.md) §4.1.
> **EXCLUSIVAMENTE SHADOW** — o legado permanece EFFECTIVE (resposta oficial ao usuário); o Kernel
> canônico roda em paralelo apenas para medir equivalência. **Nenhum cutover.** Nenhuma allowlist/freeze
> alterada. Nenhuma migration. Flag default OFF.

## Caminho legado efetivo (inalterado)
UI (`direct-contract-details/DocumentsTab.tsx`) → `directContracts.generate.{termoDispensa|termoInexigibilidade|minutaContrato|planilhaCotacao|mapaComparativo}` (`directContractsRouter`, `tenantProcedure`) → `directContractDocuments.ts` (`invokeLLM`, legado allowlistado) → `createDirectContractDocument` → retorna `{documentId, content}`. **Contrato público byte-a-byte inalterado.**

## Caminho canônico shadow
`directContractsRouter` (após gerar+persistir o legado) → `fireDirectContractShadow(...)` **fire-and-forget** → `directContractShadowService.runDirectContractShadow` → `executeCognitiveTask({ task: "DIRECT_PROCUREMENT_REASONING", businessDomain: "contratacao_direta", ... })` (gateway oficial; provider decidido pela política; sem `invokeLLM` novo). O resultado shadow **não** é retornado ao usuário, **não** persiste documento, **não** altera status/workflow, **não** aparece na UI.

## Feature flag
- **Nome:** `FF_DIRECT_CONTRACT_SHADOW`.
- **Avaliação:** `isFeatureEnabled(FF_DIRECT_CONTRACT_SHADOW, organizationId)` (`featureFlagService.ts`, DB, **tenant-aware**).
- **Default OFF / fail-closed** (flag ausente ou sem DB → `false`). Quando OFF: comportamento = **legado puro** (Kernel não executa). Sem seed, sem rollout %, sem valor hardcoded.

## Replay safety / idempotência
- Mecanismo único `runWithIdempotency` (sem segunda implementação).
- Chave: `dc-shadow:{organizationId}:{directContractId}:{docType}:{sha256(effectiveInput)}` (tenant + operação + entidade + versão-efetiva do input). Mesma entrada → **replay** (não reexecuta, não duplica observabilidade). Payload diferente → chave diferente (nunca reusa replay indevidamente). `payloadHash = inputHash`.

## Comparação de equivalência (estrutural, não jurídica)
`compareDirectContractShadow` (domínio puro, determinístico) — sinais estruturais normalizados por tipo (fundamento `14.133`, `objeto`, `justificativa`/`cláusula`), nº de seções, presença/ausência. Classes: `EQUIVALENT_STRUCTURE` · `STRUCTURAL_DIVERGENCE` · `MISSING_REQUIRED_FIELD` · `CANONICAL_ERROR` · `LEGACY_ERROR` · `NOT_COMPARABLE`. **Não** há julgamento "juridicamente correto/aprovado"; equivalência estrutural ≠ validação jurídica.

## Observabilidade
Reuso de `cognitive_observability` (sem migration): `executeCognitiveTask` grava a linha canônica; a **comparação** é persistida via `insertObservability` sob um `correlationId` determinístico do shadow, `payload.shadowComparison = { classification, divergenceType, legacyHash, canonicalHash, provider, model, durationMs, actor, docType, directContractId, sinais estruturais }`. **Sem chain-of-thought, sem conteúdo integral** (apenas hashes + metadados). Recuperável por `correlationId`.

## Isolamento de falhas (Bloco G)
`runDirectContractShadow` **nunca lança**; o chamador dispara fire-and-forget com `.catch`. Falha do provider canônico / timeout / comparação / observabilidade fica **observável** (logs estruturados + status), mas **não** substitui nem derruba o resultado legado. Sem retries fora da resiliência canônica.

## Multi-tenant
`organizationId` explícito em flag, idempotência e observabilidade. Flag habilitada por tenant; shadow de A não executa com contexto de B; observabilidade atribuída ao tenant correto; chave de idempotência é tenant-scoped. Coberto no smoke.

## Boundaries preservadas
`INVOKE_LLM_LEGACY_ALLOWLIST`, `AI_SDK_ALLOWLIST`, `LEGACY_ACTIVE_MAINTENANCE_ONLY` **intactas**. `directContractDocuments.ts` e `invokeLLM` **não** removidos/alterados. Nenhum novo consumidor de `invokeLLM` (o caminho novo usa `executeCognitiveTask`). `rc352`/`rc41`/legacy-freeze verdes.

## Rollback
Desligar a flag (`FF_DIRECT_CONTRACT_SHADOW`) → shadow deixa de executar; nada mais a reverter (sem migration, sem efeito no domínio).

## Testes
- Unit `direct-contract-shadow.test.ts` (classificador puro + flag fail-closed sem DB).
- Smoke MySQL `direct-contract-shadow-mysql-smoke.test.ts` (flag ON executa + observabilidade persistida sem conteúdo integral; replay não duplica; flag OFF por tenant; isolamento multi-tenant) + step no `ci.yml`.

## Homologação futura em staging (procedimento)
1. Habilitar `FF_DIRECT_CONTRACT_SHADOW` **por tenant** em staging (linha em `tenant_feature_flags`, `enabled=1`), mantendo produção OFF.
2. Gerar documentos de Contratação Direta normalmente; o shadow roda em paralelo e grava comparações em `cognitive_observability` (por `correlationId`).
3. Coletar as classificações reais e revisar divergências (humano). **Só após dados reais** define-se: nº de execuções, critério de equivalência e eventual flag de cutover — **nada disso é decidido nesta PR**.

## Limitações / fora de escopo
Sem cutover; shadow não aparece na UI; não migra `legalFrameworkAssistant`/`legalOpinionService`/`catmatMatcher`/`gemini`; não remove legado; não altera Railway/secrets/flags de produção; não define `minScore` CATMAT (fail-closed preservado).
