# Piloto Edital multi-modelo — Lane C (workflow + UX + governança + harness)

> **Base:** `main@d4bb209` (integração Templates A+B+C, #281). **Estado:** `FF_INSTITUTIONAL_TEMPLATES_V1` **OFF**, nenhum tenant habilitado, nenhuma migration nova, nenhuma escrita em produção.
> Esta lane **não** altera o conteúdo jurídico: o Modelo-Mestre BLL (`1.0.1-draft`, aprovado pela Procuradoria **fora** do sistema) é entrada humana; o que o repositório traz de "Edital" nos testes é **fixture sintética** (`Cláusula sintética NN`).

## 1. O que a lane entrega (mapa dos requisitos)

| # | Requisito | Onde |
|---|---|---|
| 1 | Catálogo **multi-modelo** (vários `documentKind=edital`) | `catalogService.ts` · router `catalog.list` · `CatalogCard`/`CatalogFilters` |
| 2 | Aplicabilidade **explícita** (modalidade · forma · plataforma · regime · critério), revisão **exata**, conflito ⇒ falha fechada | `governance/scopeDimensions.ts` · `workflowService.setBinding` · `binding.ts` (5 dimensões) |
| 3 | **Evidência de aprovação jurídica** (governança, não status) | `governance/legalEvidence.ts` · `governanceService.ts` · adapter sobre o ledger existente |
| 4 | Registro/importação do 1º modelo (nasce **DRAFT**) | `modelRegistrationService.ts` (`MODEL_REGISTRATION_PRESETS[0]` = BLL) |
| 5 | **Matriz de prontidão** (11 verificações, PASS/BLOCKED/NOT_APPLICABLE) | `governance/readinessMatrix.ts` · `readinessService.ts` · aba "Prontidão" |
| 6 | **Preview** com contexto de teste, sem efeitos | `previewDossierService.ts` · `PreviewDossierPanel` |
| 7 | Tudo sob `/modelos-institucionais[/:identityId]`; filtros tipo/modalidade/forma/plataforma/status | `InstitutionalTemplates.tsx` · `InstitutionalTemplateDetail.tsx` (nenhuma rota nova) |
| 8 | Feature OFF bloqueada no backend (rota direta) | `templatesProcedure` (flag por organização) — provado em unit e MySQL |
| 9 | **Harness** executável | `pilot/editalPilotHarness.ts` · `scripts/edital-pilot-harness.ts` |
| 10 | Testes | `server/__tests__/{unit,integration}/*edital-pilot*` · `client/src/**/*EditalPilot*` |

## 2. Contratos (e por que não há schema novo)

* **Ledger existente.** Procedência da importação e evidência jurídica são **decisões append-only** em `institutional_decisions` (assunto = id **exato** da revisão), com os tipos aditivos `template_import_provenance` / `template_legal_approval_evidence` (resultado `registrado`) e assuntos `institutional_template.import_provenance` / `institutional_template.legal_evidence`. Os campos estruturados (versão lógica da fonte, SHA-256, hash semântico da revisão, instante, parecer…) vão como linhas `chave=valor` em `evidence` (codec `governance/kv.ts`; chave fora da allowlist é ignorada). `lockDecisionSubject` ganhou os dois assuntos (mesmo lock da linha da revisão). **Nenhuma tabela, coluna, FK ou migration.**
* **Evidência não é status.** O ciclo continua `DRAFT → APPROVED → PUBLISHED → DEPRECATED`. Registrar evidência **não** transita a revisão, **não** grava `approval_decision_id` e **não** gera evento de transição (provado em MySQL real, P3). A importação **nunca** nasce `APPROVED/PUBLISHED`, mesmo com aprovação jurídica externa.
* **Nada é inventado.** Número/data do parecer, protocolo e procurador são **opcionais**: ausentes ⇒ não gravados ⇒ a UI mostra "não informado". Preserva: versão lógica da fonte, SHA-256 da fonte, hash semântico da revisão ligada, **quem registrou** (`recordedByUserId`, usuário autenticado), **quando** (`recordedAt`), base/referências. A autoridade declarada segue `NOT_VALIDATED_POLICY_PENDING` (o sistema não valida competência jurídica).
* **Humano-only.** Todo ato novo exige `assertHumanActor` + `confirm: true` + idempotência; piso técnico: registrar/importar = `operator`; evidência = `manager` (como aprovar). CAS pela versão que a pessoa viu (`expectedVersion`); replay pela chave converge (o `recordedAt` do replay é o já gravado — corrigido após o smoke em MySQL real).
* **displayName / forma / plataforma.** O T1 não tem `displayName`; esta lane **não** altera a identidade. Ordem do nome exibido (com a origem sempre exposta): `displayName` da identidade (se a Lane A o fornecer) → nome da procedência registrada → `slug`. O nome **nunca** participa de resolução de binding.
* **Escopo de 5 dimensões.** `BindingScope` ganhou `form` e `platform` (domínio puro; `undefined ≡ ausente`; igualdade **exata**). Sem coluna na persistência atual (`0316` grava 3), então: (a) `setBinding` recusa dimensão não suportada (`SCOPE_DIMENSION_UNSUPPORTED`, via `capabilities.scopeDimensions`); (b) o repositório de bindings **recusa** `form`/`platform` antes de tocar o banco; (c) a resolução compara as 5 dimensões, de modo que escopo declarado diferente nunca resolve o modelo errado.

### Dependência de integração (Lane A do piloto)

Enquanto a persistência não gravar `form`/`platform` (migration da Lane A), **nenhum binding de Edital pode ser criado** (a regra explícita exige forma/plataforma e a persistência as recusa — falha fechada, provado). Quando a Lane A entregar as colunas: trocar `capabilities.scopeDimensions` do adapter para as 5 dimensões, remover o guard de `bindings.ts` e mapear as colunas em `rowToBinding`/`insertBinding`. O harness `--simulate-lane-a-scope` ensaia esse estado.

## 3. Matriz de prontidão (antes de publicar)

Onze verificações, **todas sempre presentes**: `SOURCE_PROVENANCE` · `INPUTS_ACCOUNTED` · `CONTROL_ONLY_INPUTS` · `CONDITION_TYPES` · `ITEMS_BACKING` · `TR_EXACT_PIN` · `CERTAME_CONFIG` · `ANNEX_MAPPING` · `XREF_INTEGRITY` · `AI_SLOTS` · `LEGAL_APPROVAL_EVIDENCE`. Estados: `PASS` / `BLOCKED` / `NOT_APPLICABLE`. O que não pode ser provado é `BLOCKED` com o motivo (nunca omitido).

* O **inventário da fonte** (`tpl-source-inventory/1`: entradas com disposição `VARIABLE|CONTROL_ONLY|ITEMS_TABLE`, tipos de condição, mapa de anexos, referências cruzadas, slots de IA, contagens declaradas — ex.: 160 / 3 / 48) é **confrontado com o AST real**: todas as entradas mapeiam no catálogo; *control-only* só controla condição (nunca aparece no texto); todo tipo de condição existe no AST e toda condição do AST tem tipo declarado; anexos mapeados um-a-um; destino de referência cruzada existe; slots de IA declarados = slots do AST.
* Só o **hash** e as contagens do inventário ficam na procedência; o conteúdo é **reenviado** na avaliação e precisa ter o mesmo SHA-256 (inventário adulterado ⇒ `BLOCKED`).
* Capacidades reais (`BASELINE_CAPABILITIES_D4BB209`): `ITEMS` **sem backing** (⇒ `BLOCKED` se o modelo usa ITEMS/tabela dinâmica); `CERTAME_CONFIG` **inexistente**; pin exato do TR **existe**; produtor automático de IA **não existe** (informativo; aceite humano exato existe).
* **Gate de publicação (regra de governança).** `PASS` e `NOT_APPLICABLE` são admissíveis; **qualquer `BLOCKED` ⇒ `PUBLICATION_BLOCKED`**. Antes de `APPROVED → PUBLISHED` o **backend recalcula** a matriz com o estado autoritativo atual (revisão, procedência e evidência do ledger, capacidades do sistema) por um **port estreito** (`TemplateReadinessPort`) — **nunca** confia em matriz do cliente (o contrato de `publish` não tem campo de matriz nem de "aceite de bloqueio"; `.strict()` rejeita). `acceptedBlockedChecks` **foi removido**: uma decisão humana não substitui pré-condição estrutural/técnica ausente.
  * Com qualquer `BLOCKED`: **zero** decisão institucional, **zero** mudança de status, **zero** evento; erro estável `PRECONDITION_FAILED/PUBLICATION_BLOCKED` listando **todos** os blockers (`code=id da verificação`, `path=readiness.<id>`, motivo) e o `matrixHash`.
  * Port ausente/falha/matriz de outra revisão ⇒ `READINESS_UNAVAILABLE` (falha fechada; o detalhe interno não vaza).
  * O cliente só envia o **inventário da fonte** (dado), autenticado pelo SHA-256 registrado na procedência: inventário adulterado ou ausente ⇒ `BLOCKED` (não há como "forçar PASS").
  * Com todos `PASS`/`NOT_APPLICABLE`: a mesma decisão `template_publication` (uma só authority) persiste `readiness.matrixHash`, `readiness.checkedAt` e `readiness.statuses` (`ID:STATUS,…`) na evidência. Replay converge (as linhas `readiness.*` são do servidor e ficam fora da comparação do pedido humano) sem reavaliar nem regravar.
  * Escopo do gate: `READINESS_GATED_KINDS = ["edital"]` (estender a outros tipos é decisão de produto; os demais tipos publicam como antes).
  * Residual conhecido: a matriz é calculada imediatamente antes da transação de publicação; a CAS de status garante uma única publicação, mas uma evidência substituída nesse intervalo não é re-checada dentro da mesma transação (a evidência é append-only e a publicada permanece rastreada no `readiness.checkedAt`).
* Interpretações a confirmar com o dono do conteúdo (ficaram explícitas no código): *control-only = entrada usada só em condições*; *tipo de condição = variável avaliada por ≥ 1 condição do AST*.

## 4. Preview (dossiê)

Contexto de teste selecionável: escopo (as 5 dimensões, que preenchem os parâmetros `edital.modalidade/forma/plataforma/criterioJulgamento/regimeExecucao` **só se o catálogo os tiver e o valor não for informado**) + valores de exemplo. Mostra identidade, revisão exata, contexto, decisões das condições, pins de fonte, tabelas dinâmicas, anexos, referências, slots de IA (marcador, **IA não chamada**) e prévia do manifest (`persisted:false`). Binding ausente/ambíguo/inválido ⇒ `NOT_RESOLVED` **sem** prévia. Sem efeitos: zero escritas (provado por contagem), sem documento oficial, sem emissão, sem publicação, sem processo.

## 5. Harness do piloto (roteiro executável)

```
1 REGISTER → 2 LEGAL_EVIDENCE → 3 READINESS → 4 APPROVE → 5 PUBLISH → 6 BIND → 7 PREVIEW
→ 8 COMPOSE → 9 INSPECT_M1 → 10 HUMAN_REVIEW → 11 REVALIDATE → 12 ISSUE_TEST_ARTIFACT
```

* **dry-run (padrão)** — ports em memória + fixture sintética (160 entradas, 3 control-only, 48 condições, 4 anexos): roda 1–7; 8–9 `REQUIRES_STAGING`; 10–12 humanos.
  `pnpm tsx scripts/edital-pilot-harness.ts --mode=dry-run --simulate-lane-a-scope --confirm=REGISTER,LEGAL_EVIDENCE,APPROVE,PUBLISH,BIND`
  (opções de simulação: `--with-items --with-certame --all-capabilities --json`).
* **staging** — ports reais; exige `APP_ENV=staging|development`, **flag já ligada pelo operador** na organização de TESTE (o harness **nunca** a liga), `--process-id` de um processo de **teste** (recusa `2026/253`), `--ast-file/--inventory-file/--source-version/--source-sha256/--authority-file` (conteúdo **real** vem daqui, nunca do repositório). 8–9 usam composição e manifest reais.
* **Regras:** decisões humanas só rodam se listadas em `--confirm` (uma pessoa as confirmou, com a autoridade de `--authority-file`); `PUBLISH` **falha** (`PUBLICATION_BLOCKED`) se o servidor encontrar qualquer `BLOCKED` — não existe aceite de bloqueio; 10–12 são **sempre** humanos (aceite exato da IA, revalidação canônica, emissão pela promoção oficial) — o harness só imprime a rota e verifica pré-condições; para na primeira pendência.
* **Não executado em produção. Não toca o processo 2026/253.** Nesta lane o harness só foi executado em dry-run e em MySQL local descartável.

### Roteiro humano (staging) — após o harness parar em `HUMAN_REVIEW`

1. Editar o rascunho (edição governada) e aceitar cada narrativa de IA pelo **hash exato** (`reviews.acceptAiNarrative`); reconhecer desvios estruturais (`reviews.acknowledgeDeviation`).
2. Emitir pela promoção oficial com `templateIssuance` (revalidação canônica; `SOURCE_CHANGED` bloqueia; gera o M2 na mesma transação). Artefato **de teste**, processo **de teste**.
3. Conferir `explainManifest` (M1/M2 apontam para a **revisão exata** publicada e vinculada).

## 6. Segurança e regressão

* Tenant sempre do contexto (schemas `.strict()` recusam `organizationId`); revisão de outro tenant ≡ inexistente (mensagem idêntica por endpoint).
* RBAC: leitura/prévia/prontidão = `viewer`; registrar/importar = `operator`; evidência/aprovar/publicar/vincular = `manager`.
* Feature OFF: catálogo, governança, registro, prontidão e dossiê retornam `PRECONDITION_FAILED/MODULE_DISABLED` por rota direta; nenhuma linha escrita (MySQL, P7).
* Nenhum arquivo de schema/migration/Graphify foi alterado; guard de FKs e validador de boot limpos (P8).
