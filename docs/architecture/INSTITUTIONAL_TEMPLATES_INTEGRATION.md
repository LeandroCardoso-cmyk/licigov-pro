# Institutional Templates — integração final (A persistência + B composição + C workflow/UX)

> **Estado:** pacote ÚNICO integrado sobre a `main` (`dffa7ff`, T1 + G0 oficial + HD-26 `OPTION_A`). Flag `FF_INSTITUTIONAL_TEMPLATES_V1` **OFF**, nenhum tenant habilitado, nenhuma migration aplicada em produção, nenhum documento real gerado.
> Este documento substitui, para a integração, as seções de "contrato dos ports" dos documentos das lanes B e C (mantidos como histórico das decisões de cada lane).

## 1. Camadas e quem é dono de quê

| Camada | Onde | Natureza |
|---|---|---|
| Domínio puro (T1 + composer + revalidação) | `server/domain/institutionalTemplates/**` | sem I/O; mesma entrada ⇒ mesma saída |
| Persistência (migration `0316`, HD-26) | `drizzle/schema.ts`, `drizzle/0316_*.sql`, `server/db/institutionalTemplates/**` | 6 tabelas novas, 9 FKs compostas de tenant, `RESTRICT`, sem `CASCADE`, nenhum DDL em tabela existente |
| Guard de schema | `server/db/schemaForeignKeyGuard.ts` (+ `server/db/institutionalTemplates/schemaContract.ts`) | uma só autoridade de contrato, usada pelo validador de boot (`collectSchemaProblems`) e pelo `db:audit` |
| Ports (contrato único) | `server/services/institutionalTemplates/ports.ts` | ver §2 |
| Adapters reais | `server/services/institutionalTemplates/adapters/**`, `integration.ts` | um adapter por responsabilidade, sobre `server/db/**` |
| Workflow / revisão humana / composição / emissão | `workflowService.ts`, `reviewService.ts`, `templateCompositionService.ts`, `documentPromotionService.ts` (hook) | serviços |
| API + UX | `server/routers/institutionalTemplatesRouter.ts`, `client/src/pages/InstitutionalTemplate*.tsx` | tRPC tenant-scoped; rotas `/modelos-institucionais[/:identityId]` |

## 2. Reconciliação dos ports (REUSE > CONSOLIDATE > EXTEND > CREATE)

As três lanes criaram contratos em paralelo. Resultado: **um** contrato por responsabilidade.

| Responsabilidade | Lane A (repos) | Lane B (`TemplatePorts`) | Lane C (`TemplateWorkflowPorts`) | Final |
|---|---|---|---|---|
| Identidades/revisões/bindings/ciclo de vida | `server/db/institutionalTemplates/*` | `revisions` + `bindings` (leitura) | `TemplateRepositoryPort` | **`TemplateRepositoryPort`** (adapter sobre A); B lê pelo mesmo repositório |
| Manifests M1/M2 | `manifests.ts` | `TemplateManifestPort` | `ManifestReadPort` | **`TemplateManifestPort`** (leitura + INSERT-only) |
| Habilitação (flag) | — | `TemplateEnablementPort` | `TemplatesFlagPort` | **`TemplateEnablementPort`** (`isFeatureEnabled`, tenant-scoped, default OFF) |
| Catálogo de variáveis | — | `getCatalog` | `current`/`byVersion` | **`VariableCatalogPort`** (`current`/`byVersion`, registro de código) |
| Relógio | — | `nowIso` | `now` | **`ClockPort.now`** |
| Rascunho canônico, fontes canônicas, revisão humana, transação | — | `drafts`, `canonical`, `review`, `transactions` | — | mantidos (sem equivalente nas outras lanes) |

`TemplatePorts` (composição/emissão) e `TemplateWorkflowPorts` (workflow/API) são só **agregações** dos mesmos membros. Cada membro é implementado **uma vez**. Sem backing ⇒ `createUnavailableTemplatePorts()` / `PORTS_NOT_CONFIGURED` (falha fechada; nenhum fallback em memória).

Ajuste de contrato relevante: o M1 **não** carrega a versão oficial (`officialDocumentId` pertence ao M2); `insertGenerationManifest` devolve `{ created }` — só quem cria o M1 gera a versão oficial `gerado`, de modo que repetição/concorrência nunca duplica a versão.

## 3. Ciclo de vida atômico (blocker resolvido)

`commitLifecycleTransition` (adapter sobre a Lane A) executa, **numa única transação** (`withTemplatesTransaction`, retry SEM-084 da transação inteira):

1. `lockDecisionSubject` — extensão do mecanismo **existente** (sem segundo ledger/lock) para os assuntos `institutional_template.{approval,publication,deprecation}` (trava a linha da **revisão**, tenant-scoped; revisão de outro tenant ≡ inexistente) e `…{ai_acceptance,deviation_acknowledgment}` (trava o **M1**);
2. replay pela chave de idempotência (mesma chave + mesmo pedido ⇒ decisão já gravada; outro pedido ⇒ conflito);
3. CAS no estado esperado (`STALE_STATUS` sem escrita);
4. `INSERT` da decisão (ledger append-only) + `transitionRevisionStatus` (CAS + evento do modelo).

Qualquer falha ⇒ **rollback total** (decisão, transição e evento juntos). Provado em MySQL real (gatilho que falha depois da decisão) e no smoke de integração. `APPROVED ≠ PUBLISHED` (decisões distintas); a depreciação grava decisão própria, validada (id + tenant) e registrada no **evento** da transição — a linhagem prova a decisão sem acrescentar FK à revisão. *Finding:* se um dia for necessário consultar a decisão de depreciação por revisão sem ler eventos, é preciso uma coluna estrutural (`deprecation_decision_id`) — **não** criada aqui (migration `0316` permanece em 6 tabelas).

## 4. Autoridade

`authorityValidation = NOT_VALIDATED_POLICY_PENDING` em toda decisão. O piso de papel (`manager` para aprovar/publicar/depreciar/vincular; `operator` para editar/gerar/revisar) é **controle técnico de acesso**, nunca competência jurídica validada. Nenhuma IA decide competência; nenhum sistema infere autoridade pelo papel.

## 5. Geração, revisão humana e emissão

```
fontes canônicas → binding exato (PUBLISHED, pin) → composição determinística → M1 (+ rascunho + versão `gerado`, 1 transação)
→ edição humana governada → aceite humano EXATO das narrativas de IA → revalidação canônica → M2 (na transação da emissão oficial)
```

* **Rascunho:** `generated_documents` via `applyDraftContentMutationTx` (operação `template_compose`, ledger desde a criação, autoria preservada), marcador `origem:template`. Nunca sobrescreve rascunho existente com outro conteúdo (falha fechada; conteúdo idêntico ⇒ replay).
* **Fontes:** `PROCESS`, `IDENTITY`, `DFD/ETP/TR` (última versão **oficial emitida**) e `PARAMS` (parâmetros do Edital). `ITEMS` não tem backing ⇒ falha fechada. O catálogo embutido `tpl-catalog/1` só usa fontes resolvíveis; o catálogo de produção completo é das fases T4/T5 (nova versão; versões antigas seguem resolvíveis para replay).
* **Staleness:** rascunho `origem:template` é governado pela **revalidação canônica do M1** (estado `template_governed` no guard de fontes de autoria); `SOURCE_CHANGED` bloqueia a emissão — nada é regenerado, atualizado ou emitido automaticamente.
* **IA (supervisionada):** só em `aiSlot`; a saída é lida **por `executionId`** em `ai_orchestrations.outputs.templateNarrative = { slotKey, text }` (tenant-scoped; forma inesperada ⇒ ausente ⇒ emissão bloqueada). O texto nunca vem do cliente. O aceite é uma decisão institucional humana (`institutional_template.ai_acceptance`, assunto `<manifestId>:<sha256(slot)[0..16]>`), exato em slot + execução + hash da saída. A IA nunca aprova, publica, deprecia, emite, escolhe revisão/binding nem decide regra jurídica.
* **Emissão:** `promoteOfficialDocument({ templateIssuance })`. Sem M1 ⇒ caminho existente intacto (hook devolve `null`). Com M1 e módulo **desabilitado** ⇒ **bloqueio** (nunca emite documento composto sem M2).
* **Feature OFF:** o backend recusa toda mutação do workflow, geração e revisão (`MODULE_DISABLED`/`TEMPLATE_COMPOSITION_DISABLED`); o menu só aparece com `getCapabilities.enabled`, e a rota direta não libera nada.

## 6. Importação (contrato correto)

`Markdown/DOCX → candidato → validação de AST (whitelist T1) → DRAFT`. Nunca `APPROVED`/`PUBLISHED`.

* **Permitido:** placeholder simples de catálogo `{{variavel}}` — o nome precisa casar `VARIABLE_NAME_RE` **e** existir no catálogo.
* **Rejeitado:** macros/expressões ativas — `{{#…}}`, `{{{…}}}`, `{% … %}`, `${…}`, placeholder com expressão —, HTML ativo, script, macro DOCX (`.docm`/`vbaProject`), OLE/ActiveX/embeddings, URL insegura, nó de AST desconhecido e variável fora do catálogo.
* O Modelo-Mestre BLL permanece `READY_FOR_LEGAL_REVIEW` / `FROZEN_FOR_LEGAL_REVIEW` / `NOT_ACTIVE` / `NOT_PUBLISHED` (não importado, não ativado).

## 7. Decisões e limites conhecidos (não bloqueantes)

* `displayName` não existe no T1: a UX usa `slug` + tipo documental (`POST_FAST_TRACK_UX_ENHANCEMENT`).
* Só `dfd/etp/tr/edital` têm rascunho canônico; demais tipos falham fechado na geração por modelo.
* O produtor das execuções de IA para modelos (orquestração que grava `ai_orchestrations.outputs.templateNarrative`) é fase posterior; o consumidor e o aceite estão prontos e testados.
* Flag: sem rollout percentual; ligar/desligar por organização é decisão operacional futura (nesta entrega: OFF).

## 8. Matriz de prova

| Prova | Onde |
|---|---|
| Migration fresh / 0315→0316 / replay / estado parcial / drift / rollback | `templates-0316-migration-mysql-smoke.test.ts` |
| Repositórios (tenant, imutabilidade, M1/M2, concorrência, RESTRICT, leitura fail-closed) | `templates-persistence-mysql-smoke.test.ts` |
| Ciclo completo A+B+C, cross-tenant, replay, concorrência, SOURCE_CHANGED, IA, feature OFF, schema, rollback do ciclo de vida | `templates-integration-mysql-smoke.test.ts` |
| Contratos reconciliados, catálogo, tradução de erros, prévia pelo composer real, regras estruturais | `institutional-templates-integration.test.ts` |
| Domínio T1, composer/revalidação, workflow, API/RBAC, importação, UX | testes das lanes (`institutional-templates-*`) |
