# Modelos Institucionais — Lane C: workflow, API, UX, importação e prévia

> **Estado:** implementado sobre `T1_BASE` (`ba7b91d`) na branch `work/templates-fast-c-workflow-ux`, **sem** schema, migration, FK, Document Engine, composer ou publicação externa. Persistência (Lane A) e composer (Lane B) entram por **ports** e são ligados pela integration branch. Módulo atrás da flag `FF_INSTITUTIONAL_TEMPLATES_V1` (default OFF; não ligada aqui).

## O que existe

| Camada | Arquivos | Papel |
|---|---|---|
| Ports | `server/services/institutionalTemplates/ports.ts`, `portsRegistry.ts` | `TemplateRepositoryPort`, `CompositionPort` (`previewComposition`, `resolveExactBinding` opcional), `VariableCatalogPort`, `ManifestReadPort`, `TemplatesFlagPort`, `ClockPort`, `IdPort`; `configureTemplateWorkflowPorts(...)` |
| Workflow | `workflowService.ts` | identidades, revisões, aprovar/publicar/depreciar, bindings exatos, prévia, explicabilidade |
| Autoridade | `authority.ts` | piso de papel por ação; `assertHumanActor` (IA/sistema nunca agem) |
| Importação | `importPipeline.ts` | Markdown/DOCX → candidato → validação (whitelist T1) → AST candidato → **somente DRAFT** |
| Explicabilidade | `explainability.ts`, `astSummary.ts` | resumo de composição/manifest sem conteúdo interno |
| API | `server/routers/institutionalTemplatesRouter.ts` (`institutionalTemplates.*`) | tRPC tenant-scoped; `organizationId` nunca vem do cliente |
| UX | `client/src/pages/InstitutionalTemplates*.tsx`, `client/src/components/institutionalTemplates/*`, `client/src/lib/institutionalTemplatesView.ts` | lista, detalhe, revisões, estrutura/edição do DRAFT, prévia, vínculos, importação, explicação |
| Rotas | `/modelos-institucionais`, `/modelos-institucionais/:identityId` | distintas do `/templates` legado (inalterado) |

## Regras aplicadas

- Lifecycle `DRAFT → APPROVED → PUBLISHED → DEPRECATED` (sem `IN_REVIEW`/`RETIRED`). Aprovar **não** publica; cada transição grava uma **decisão institucional distinta** no ledger existente (`institutional_decisions`) via `planDecision`. O catálogo **puro** de `server/domain/institutionalDecision.ts` ganhou, de forma aditiva, os tipos `institutional_template.approval|publication|deprecation` e resultados `aprovado|publicado|depreciado`.
- A autoridade é a **declarada** no ato (nome, cargo, data, referência, justificativa); `authorityValidation` permanece `NOT_VALIDATED_POLICY_PENDING`. O piso de papel (`manager`) é técnico, não competência jurídica.
- Ações institucionais exigem ator **humano**, `confirm: true` explícito, estado esperado (CAS) e chave de idempotência.
- `PUBLISHED` é imutável (`REVISION_IMMUTABLE`); alterar = nova revisão DRAFT (`createDraft.fromRevisionId`). `DEPRECATED` continua legível, pré-visualizável e explicável para replay.
- Binding **sempre** por id exato de revisão `PUBLISHED`; ambíguo ⇒ falha fechada; revisão fixada por binding ativo não pode ser depreciada.
- Prévia: nenhuma IA é chamada (slots recebem marcador), nada é persistido; explicação expõe identidade, revisão exata, pins `srcd:`, decisões condicionais, narrativa de IA (presença/aceite) e identidade/hash do manifest.

## Contrato para a integration branch

1. Chamar `configureTemplateWorkflowPorts({ repository, catalog, composition, manifests, flag: platformTemplatesFlagPort(), clock: systemClock, ids: randomIds })` na inicialização. Sem isso, todas as operações falham fechado (`PORTS_NOT_CONFIGURED`) e `getCapabilities` devolve `enabled: false`.
2. `TemplateRepositoryPort.commitLifecycleTransition` deve gravar **a decisão e a transição na mesma transação local**, com CAS no estado esperado e replay pela chave de idempotência da decisão; e `lockDecisionSubject` (`server/db/institutionalDecisions.ts`) precisa reconhecer os três subject types de modelo (hoje só `direct_procurement.ratification`; os novos retornam "não existe" ⇒ fail-closed até o adapter da Lane A).
3. `CompositionPort.previewComposition` é o composer puro da Lane B (mesmo contrato `ComposeFn` do T1). `resolveExactBinding` é opcional; sem ele a lane usa `resolveTemplateBinding` do domínio sobre o repositório.
4. A flag usa o mecanismo existente (`isFeatureEnabled`, tenant-scoped). **Não** configurar `percentage < 100` (não há rollout percentual).

## Lacunas conhecidas (para a integração decidir)

- `TemplateIdentity` (T1) não tem nome de exibição: a UX usa `slug` + tipo documental.
- A decisão de **depreciação** é gravada no ledger, mas o shape T1 de `TemplateRevision` só guarda `approvalDecisionId`/`publishDecisionId`; o id da decisão de depreciação é devolvido na resposta e fica no ledger (assunto = id da revisão).
- Importação DOCX usa `mammoth` (dependência já existente) → HTML → candidato; imagens e conteúdo ativo são recusados; tabelas são suportadas. Não há importação de estilos.
- O editor do DRAFT é um editor estruturado assistido (contorno + edição do AST validada pelo servidor). Um editor visual rico fica para fase posterior.
- O Modelo-Mestre BLL v1.0.1-draft **não** foi importado nem ativado.
