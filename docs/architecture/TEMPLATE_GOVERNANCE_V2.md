# ADR-TG-V2 — Governança escalável de Modelos Institucionais (templates)

- **Status:** implementado, endurecido e com marco de transição imutável (migration aditiva 0318), na branch `feat/template-governance-v2`. Sem merge, sem deploy, sem migration executada em produção, sem mutação de dados produtivos.
- **Baseline:** `main` @ `c7ead2b6` (PR #293). Revisão 1 do Edital PUBLISHED e vinculada; Revisão 2 DRAFT (`trec9c3113392f420d5ec8`) — **nenhuma delas é tocada por esta mudança**.
- **Precedência:** [`PRODUCT_NORTH_STAR.md`](PRODUCT_NORTH_STAR.md). Complementa [`INSTITUTIONAL_TEMPLATES_MULTIMODEL.md`](INSTITUTIONAL_TEMPLATES_MULTIMODEL.md), [`EDITAL_PILOT_LANE_C.md`](EDITAL_PILOT_LANE_C.md) e [`INSTITUTIONAL_DECISION_CONTRACT.md`](INSTITUTIONAL_DECISION_CONTRACT.md).

## 1. Contexto e decisões de produto

O LiciGov Pro é uma camada cognitiva/operacional para **ELABORAR** documentos. Não é sistema de publicação oficial e não substitui a análise jurídica da Procuradoria, que acontece na fase institucional própria do documento.

1. **Publicar um modelo no catálogo interno ≠ publicar um documento oficial.** `PUBLISHED` numa revisão de template significa *disponível para elaboração* (`REVISION_PUBLISH_MEANING = TEMPLATE_CATALOG_PUBLICATION`). Não existe, e esta mudança não cria, mecanismo de publicação externa.
2. **Parecer jurídico prévio não é condição universal.** É obrigatório somente quando uma regra institucional o configura; opcional caso contrário; auditável quando registrado; nunca presumido; nunca fabricado por IA.
3. **Padrão OPTIONAL (decisão do Owner) — sem reinterpretar nada persistido.** A evidência jurídica prévia do template **não** é obrigatória universalmente: o padrão da plataforma para templates novos é `OPTIONAL`; cada prefeitura pode estabelecer `REQUIRED`. Decisões explícitas dos órgãos prevalecem sempre; órgãos que já tinham modelos antes da transição e não registraram política seguem, **de forma explícita e visível** (`LEGACY_COMPAT`), no regime anterior (`REQUIRED`) até decidirem (§9). Nenhum controle some em silêncio.
4. **Cada prefeitura pode usar seus próprios modelos** — da plataforma, próprios (upload/autoria) ou derivados — com versionamento independente, lineage preservado e escolha de qual versão usar em novos documentos (vínculos já existentes). Autonomia não dispensa segurança, rastreabilidade nem conformidade.

## 2. Diagnóstico (Fase A — Graphify + leitura do código)

Consultas: `tools/graphify/run.sh explain` sobre `evaluateReadiness`, `TemplateGovernanceService`, `ModelRegistrationService`, `InstitutionalTemplatesWorkflow`, `templatesProcedure`; confrontadas com o código real.

| Capacidade | Onde já existia | Lacuna encontrada |
|---|---|---|
| Identidade/revisão (DRAFT→APPROVED→PUBLISHED→DEPRECATED), imutabilidade, hash semântico | `workflowService`, `repositoryAdapter` | — (reaproveitado integralmente) |
| Ledger append-only de decisões (CAS, idempotência, lock do assunto) | `institutional_decisions`, `institutionalDecisionService` | Nenhuma decisão de **política do órgão** sobre modelos |
| Procedência de importação | `importProvenance` (`institutional_template.import_provenance`) | Sem **origem** (plataforma/própria/derivada), sem lineage, sem arquivo original |
| Matriz de prontidão (12 verificações) + witness anti-TOCTOU | `readinessMatrix`, `readinessWitness`, `commitLifecycle` | `LEGAL_APPROVAL_EVIDENCE` era **incondicional** e misturada às verificações técnicas |
| Registro/importação (AST, pacote, Markdown, DOCX) | `ModelRegistrationService`, `importPipeline` | SHA-256 do arquivo era declarado pelo cliente; original não preservado |
| Multi-tenant e RBAC | `templatesProcedure(action)`, `TEMPLATE_ACTION_MIN_ROLE` | Sem piso configurável por órgão para aprovar/publicar |
| Vínculos (binding) fixando revisão exata | `setBinding` | — (reaproveitado; garante pinning) |
| Frontend de governança | `InstitutionalTemplates*.tsx`, `ReadinessMatrixPanel` | Sem origem, política, derivação, camadas |

Conclusão: **o motor de revisões, o ledger, o pipeline de importação e o RBAC são reaproveitados**; as lacunas são de contrato (origem/política/camadas) e de uma operação (derivação).

## 3. Contratos

Domínio puro em `server/domain/institutionalTemplates/governance/templateGovernanceV2.ts`.

```
TemplateOwnership   = PLATFORM | TENANT | DERIVED
TemplateSource      = PLATFORM_CATALOG | TENANT_UPLOAD | TENANT_AUTHORED     (combinações válidas em ORIGIN_ALLOWED_SOURCES)
TemplateLineage     = PLATFORM_PACKAGE{packageKey,packageVersion,sourceSha256} | TENANT_REVISION{identityId,revisionId,semanticHash}
TemplateOrigin      = { ownership, source, lineage|null, original|null{sha256,sizeBytes,filename,contentType,storageKey,preservation=READBACK_SHA256}, declaredAuthor|null }
                      (upload ⇒ original OBRIGATÓRIO, com storageKey não nula e preservação verificada)
TemplateGovernancePolicy = { legalEvidence: REQUIRED|OPTIONAL, approveMinRole: manager|owner, publishMinRole: manager|owner }
TemplateGovernancePolicyKind = PLATFORM_DEFAULT (OPTIONAL) | TENANT_DEFINED | LEGACY_COMPAT (REQUIRED, regime anterior) | UNRESOLVED_STRICT (REQUIRED, não resolvida/ilegível)
ReadinessLayer      = TECHNICAL_TEMPLATE_READINESS | TENANT_TEMPLATE_POLICY | DOCUMENT_LEGAL_REVIEW
```

Regras: o cliente **nunca** declara `ownership`/`source` (inferidos pelo servidor a partir do tipo de origem do registro); piso de papel só pode ser **elevado** (≥ `manager`); política corrente **ilegível** ⇒ `UNRESOLVED_STRICT` (`REQUIRED`, `malformed: true`) — falha fechada; `evaluateReadiness` sem política resolvida também é estrito (nunca assume `OPTIONAL` por omissão).

Resolução da política efetiva (`resolveEffectiveTemplateGovernancePolicy(history, {legacyOrganization})`):

| Estado do órgão | Política efetiva | Evidência jurídica |
|---|---|---|
| Decisão explícita válida (qualquer regime) | `TENANT_DEFINED` (a de maior versão) | conforme o órgão decidiu |
| Sem decisão e **sem** modelo anterior ao marco de transição | `PLATFORM_DEFAULT` | `OPTIONAL` |
| Sem decisão e **com** modelo anterior ao marco | `LEGACY_COMPAT` | `REQUIRED` (regime anterior preservado) |
| Decisão corrente ilegível | `UNRESOLVED_STRICT` | `REQUIRED` |

O **marco de transição** é um registro **imutável** da plataforma (`template_governance_transitions`, chave `LEGACY_POLICY_CUTOVER`), criado e semeado **uma única vez pela migration 0318** com o **instante efetivo da sua aplicação (UTC, ISO-8601 com ms)** — isto é, o instante do **primeiro deploy** da Governance V2 (Railway `preDeployCommand: pnpm db:release:predeploy`). Não há variável de ambiente, constante nem rota que o defina ou altere (guardas estáticas); a aplicação só **lê**. `INSERT IGNORE` por chave: reaplicar a migration, migrar de novo ou fazer deploys futuros **nunca** o move nem reclassifica órgãos. "Órgão legado" = possui ao menos uma identidade de modelo criada **antes** do marco (criada exatamente no marco ou depois = novo; data ilegível ⇒ legado, estrito).

**Fail-closed:** marco ausente, ilegível ou erro de leitura ⇒ `UNRESOLVED_STRICT` para todo órgão sem política registrada (inclusive órgão novo) — exatamente o comportamento anterior à V2. O padrão `OPTIONAL` só vale quando o marco pode ser lido. Auditoria por consulta somente leitura: `SELECT marker_key, cutover_at_iso, recorded_by, recorded_at FROM template_governance_transitions;`.

## 4. Fluxo de governança revisado (Fase B)

```
 registrar/derivar/importar ──▶ DRAFT
        │
        ▼  matriz de prontidão (calculada no servidor, com witness)
   ┌────────────────────────────────────────────────────────────────────────┐
   │ L1 TECHNICAL_TEMPLATE_READINESS  (estrutura, variáveis, procedência…)  │ sempre exigida
   │ L2 TENANT_TEMPLATE_POLICY        (LEGAL_APPROVAL_EVIDENCE)             │ conforme política do órgão
   │ L3 DOCUMENT_LEGAL_REVIEW         (documento elaborado — Procuradoria)  │ fora deste módulo
   └────────────────────────────────────────────────────────────────────────┘
        ▼  aprovar (humano, piso ≥ manager ou o elevado pela política)
   APPROVED ──▶ publicar no CATÁLOGO INTERNO (humano; piso idem) ──▶ PUBLISHED ──▶ vincular (escopo explícito, revisão exata)
```

`LEGAL_APPROVAL_EVIDENCE`:

| Política | Sem evidência | Evidência válida | Evidência obsoleta/divergente |
|---|---|---|---|
| `REQUIRED` (`TENANT_DEFINED`, `LEGACY_COMPAT`, `UNRESOLVED_STRICT`) | **BLOCKED** (como antes) | PASS | **BLOCKED** (como antes) |
| `OPTIONAL` (`PLATFORM_DEFAULT` ou `TENANT_DEFINED`) | NOT_APPLICABLE (explicado) | PASS (auditável) | NOT_APPLICABLE + aviso |

- **Anti-TOCTOU:** o witness agora inclui `policyDecisionId`; o commit da publicação relê a política dentro da transação. Mudar a política entre o cálculo e o commit ⇒ `READINESS_STALE`, nada gravado.
- **Compatibilidade de hash:** `matrixHash`/witness só incorporam o campo de política quando ela **não** é `REQUIRED` — hashes do regime anterior (`LEGACY_COMPAT`/`UNRESOLVED_STRICT`) permanecem idênticos aos históricos.
- `templatesProcedure` aplica o piso elevado pela política de forma **tenant-scoped**; a plataforma nunca aceita menos que `manager`.
- A política é gravada no ledger existente (`institutional.policy` / `institutional_policy` / `estabelecida`; assunto `template-governance-policy`): humano, confirmação explícita, autoridade declarada, justificativa, CAS por versão, idempotente, append-only.

## 5. Fluxo de templates do órgão (Fase C)

- **Plataforma:** pacotes aprovados versionados no servidor. `ownership = PLATFORM`.
- **Próprio:** upload (Markdown/DOCX) ou AST ⇒ `ownership = TENANT`, `source = TENANT_UPLOAD|TENANT_AUTHORED`.
- **Derivado:** `derivation.derive` copia uma revisão **já decidida** do órgão ou um pacote da plataforma para uma **nova identidade DRAFT no mesmo tenant** (`ownership = DERIVED`, `lineage` exato). A origem permanece imutável; derivar de DRAFT é recusado; revisão de outro tenant é indistinguível de inexistente.
- **Pipeline supervisionado do upload** (reaproveita `runImportPipeline`): upload → extração → normalização → mapeamento → validação (HTML cru, URL insegura e variável desconhecida são **recusados** *antes* de qualquer armazenamento; texto que imita instrução permanece texto inerte) → **SHA-256 calculado no servidor** → **preservação VERIFICADA do original** → **revisão humana** → DRAFT → aprovação interna → disponibilização.
- **Preservação do original é requisito (fail-closed):** infraestrutura existente (`server/storage.ts`), chave `institutional-templates/{org}/originals/{sha256}-{nome-seguro}` (por conteúdo, escopada por órgão, sem travessia). O adapter grava e **lê de volta**, conferindo tamanho e SHA-256; só então devolve a `storageKey`. Sem armazenamento ⇒ `ORIGINAL_STORAGE_UNAVAILABLE`; falha ou divergência ⇒ `ORIGINAL_STORAGE_FAILED` (ambos `PRECONDITION_FAILED`, mensagem clara ao operador). Em qualquer falha: **nada é criado, publicado ou referenciado** (identidade, revisão e ledger intactos) e nenhum sucesso fictício é registrado. `getCapabilities.originalPreservation` informa a indisponibilidade à UI. Pacote e estrutura nativa não têm arquivo a preservar e seguem funcionando. Slug já ocupado ⇒ `CONFLICT` antes de armazenar. A reverificação sob demanda (`governance.verifyOriginal`) relê o objeto e recalcula o SHA-256 (`VERIFIED|MISMATCH|MISSING|UNAVAILABLE|FORBIDDEN_KEY`), só para chaves do próprio órgão, sem gravar nada.
- **Imutabilidade da origem:** gravada na procedência; alterar/remover é recusado (`ORIGIN_IMMUTABLE`); repetir é idempotente. Registros legados sem origem aparecem como `LEGACY_UNCLASSIFIED` e podem ser classificados **uma única vez**.
- **Idempotência/concorrência:** convergência pelo `slug`; N derivações idênticas simultâneas ⇒ 1 identidade, 1 revisão (espera limitada e determinística pelo estado transitório; nunca CONFLICT espúrio); mesmo slug com outra origem ⇒ `CONFLICT`.
- **Sem publicação automática** em nenhum ponto.

### 5.1 Integridade da fonte — o que é declarado e o que é provado

`explainIntegrity` (puro) distingue, e a UI exibe com o grau de garantia de cada um:

| Item | Garantia | Observação |
|---|---|---|
| Hash **declarado** da fonte jurídica | `CLIENT_DECLARED_UNVERIFIED` (ou `PLATFORM_VERSIONED` se vem do pacote da plataforma) | declaração de quem registrou; **nunca** prova criptográfica verificada |
| Hash **calculado** do arquivo enviado | `SERVER_COMPUTED` | SHA-256 dos bytes recebidos, preservado e reverificável |
| Hash **semântico** da revisão | `SERVER_DERIVED` | do conteúdo canônico; identifica a revisão imutável |
| Hash de fonte na evidência jurídica | `CLIENT_DECLARED_UNVERIFIED` | declaração; não comprova o parecer |
| Lineage (pacote/revisão do órgão) | `PLATFORM_VERSIONED` / `SERVER_DERIVED` | reverificado agora, tenant-scoped |

Relações explicadas (`MATCH|DIFFERENT|NOT_APPLICABLE|UNKNOWN`): declarado × arquivo (diferença **não** é necessariamente erro), declarado × evidência, semântico × procedência (conteúdo adaptado), origem do lineage intacta/alterada/evoluída, conteúdo × origem. `serverAssured` nunca inclui declarações do cliente.

## 6. Superfície de API (tRPC, tenant-scoped)

| Rota | Papel mínimo | Observação |
|---|---|---|
| `governance.policy.get` | viewer | efetiva (`kind`), histórico, nota e `transition` (marco, órgão legado?, explicação) |
| `governance.verifyOriginal` | viewer | reverificação sob demanda do original (somente leitura) |
| `governance.get` | viewer | procedência, evidência e `integrity` (explainability de hashes/lineage) |
| `governance.policy.record` | manager (`policy`) | humano + confirmação + CAS + idempotência |
| `derivation.derive` | operator (`register`) | humano + confirmação + idempotência |
| `registration.register` | operator | `declaredAuthor` opcional; origem inferida no servidor |
| `catalog.list` | viewer | `origin` + `originState` (`RECORDED`/`LEGACY_UNCLASSIFIED`/`MALFORMED`/`NO_PROVENANCE`) |
| `readiness.evaluate` | viewer | `layer` por verificação; `policy` aplicada |

## 7. Frontend (Fase D)

Catálogo com abas **Da plataforma · Da minha prefeitura · Derivados · Sem classificação** (contagens; "Todos" nunca esconde nada), selo de origem em cada card, ação **Derivar modelo** (só sobre revisão decidida; só com permissão), cartão **Política de governança** (leitura para todos; edição para gerentes; histórico; aviso de que não substitui a Procuradoria), diálogos de derivação e upload com nota de tratamento seguro, e matriz de prontidão **agrupada por camada** com a justificativa de cada bloqueio e a explicação do modo `OPTIONAL`. Hardening: o cartão de política mostra o regime (`Padrão da plataforma` · `Compatibilidade (regime anterior)` · `Definida pelo órgão` · `Estrita`) e a explicação da transição (confirmar o regime anterior/padrão é uma decisão válida); o painel **Integridade da fonte** separa "Declarado — não verificado" de "Calculado/Derivado pelo servidor", explica cada comparação e oferece "Reverificar arquivo original"; o formulário de registro explica e desabilita o envio de arquivo quando a preservação não está disponível. Lógica em funções puras (`institutionalTemplatesView.ts`) testadas sem jsdom.

## 8. Migrations — avaliação

**Uma migration aditiva (0318)** — requisito do Owner de um marco estável, auditável e imutável, que variável de ambiente ou constante não garantem: cria a tabela platform-level `template_governance_transitions` (sem `organization_id`, sem FK, nenhuma tabela existente alterada) e semeia o marco. Replay-safe (`CREATE TABLE IF NOT EXISTS` + `INSERT IGNORE`), schema-only quanto à estrutura e com **uma** linha de dado de plataforma determinística. Prova: `templates-0318-migration-mysql-smoke.test.ts` (fresh, upgrade com dados, replay, estado parcial) e a guarda HD-26 (apenas a tabela nova é acrescentada ao snapshot). O restante da V2 (política, origem, lineage) continua sem schema: ledger e procedência existentes.

Política e origem usam o ledger append-only e a procedência existentes; o original usa o storage S3 existente.

Otimização futura **opcional** (não necessária hoje): colunas `ownership`/`source` em `institutional_template_identities` + índice, para filtrar o catálogo no banco em vez de decodificar a procedência. Exigiria migration aditiva (nullable, sem default destrutivo), backfill a partir do ledger e staging antes de produção. Não será aplicada em produção sem autorização do Owner.

## 9. Plano de rollout e transição (padrão OPTIONAL + compatibilidade explícita)

1. Revisão humana → merge autorizado → o `preDeployCommand` do Railway (`pnpm db:release:predeploy`) aplica a **0318**, que grava o marco com o instante efetivo — **esse é o "primeiro deploy da Governance V2"**. Nada a configurar antes: não existe knob mutável (de propósito). **Antes do merge** (somente leitura, em produção): listar órgãos que ainda NÃO têm nenhum modelo (`SELECT o.id FROM organizations o LEFT JOIN institutional_template_identities i ON i.organization_id = o.id WHERE i.id IS NULL`) — só estes receberão o padrão `OPTIONAL`; todo órgão com modelos (inclusive o da Rev1/Rev2) ficará `LEGACY_COMPAT`. **Staging**: aplicar as migrations (prática existente `pnpm db:migrate:release`) antes de validar — no ambiente de staging o marco será o instante dessa aplicação, independente do de produção.
2. Órgão **legado sem política** (inclui o órgão da Revisão 1/Revisão 2): comportamento **idêntico** ao atual (evidência exigida), agora rotulado `LEGACY_COMPAT` na UI/API, com explicação. Nada é gravado em seu nome.
3. Órgão **novo** sem política: `PLATFORM_DEFAULT` (`OPTIONAL`).
4. Transição **explícita** por órgão (gerente): registrar a política — adotar `OPTIONAL` ou confirmar `REQUIRED` — encerra o `LEGACY_COMPAT` e passa a ser decisão do órgão, auditável, versionada e append-only. Nenhuma decisão `TENANT_DEFINED` é alterada pela plataforma.
5. Reverter o padrão da plataforma para `REQUIRED` (se necessário): alterar apenas `PLATFORM_DEFAULT_POLICY` (constante) — órgãos com decisão explícita não são afetados.
6. Classificação de origem dos modelos legados: opcional, um a um, por quem tem permissão.
7. **Produção:** o armazenamento S3 precisa estar configurado para envios de arquivo (sem ele o envio é recusado, de propósito).

## 10. Compatibilidade — Revisão 1 / Revisão 2 / vínculo

- Rev1 (`tr71989200d5db4dbba576`, PUBLISHED) e o vínculo `tb1a3294cd0f2cb4509614` continuam fixados na revisão exata; testes provam que política, derivação e publicação de outros modelos não os alteram.
- Rev2 permanece DRAFT. A publicação dela continua sendo decisão humana distinta (D3–D6, com autorizações próprias do Owner). O órgão da Rev1/Rev2 é `LEGACY_COMPAT` (`REQUIRED`): a exigência de evidência jurídica segue valendo até o órgão registrar a própria política — **nenhuma reinterpretação silenciosa** (teste de integração reproduz o cenário: Rev1 publicada com evidência, vínculo fixado, Rev2 DRAFT bloqueada sem evidência).
- Processo protegido 2026/253: não tocado.

## 11. Segurança

Conteúdo de arquivo é **não confiável**: validação do pipeline existente, limites de tamanho/intake, nome sanitizado, chave de storage por conteúdo e por órgão, sem execução, sem interpretação de texto como instrução. Isolamento por tenant em todas as leituras/escritas (lock de assunto, `organization_id`). Ações de ator `ai`/`system` são recusadas (`HUMAN_ACTION_REQUIRED`). A IA nunca registra evidência jurídica, política, aprovação nem publicação.

## 12. Riscos residuais

1. **Edital próprio/derivado** depende de inventário/pacote para passar nas verificações técnicas de Edital; tipos fora de `READINESS_GATED_KINDS` (apenas `edital`) não são gateados por prontidão.
2. O `sourceSha256` de um upload continua **declarado** pelo usuário (procedência), agora explicitado como declaração não verificada; `origin.original.sha256` é o calculado e verificado no servidor. Ambos ficam registrados e a diferença é explicada.
3. **Janela migration→container:** o predeploy aplica a 0318 enquanto a versão anterior ainda atende; um órgão sem NENHUM modelo que crie o primeiro entre a migration e a troca do container seria tratado como novo (`OPTIONAL`). Impacto mínimo (módulo atrás de flag por tenant; segundos). Mitigação: checagem somente leitura pré-merge (§9.1) e reclassificação futura só por decisão explícita do órgão. Marco ausente/ilegível nunca é "adivinhado": modo estrito.
4. Um órgão legado que **nunca** registrar política permanece em `LEGACY_COMPAT` indefinidamente (escolha deliberada: sem mudança silenciosa); a UI explica como sair.
5. Preservação exige S3 operacional: em ambiente sem storage o envio de arquivo é recusado (dev/CI usam porta em memória nos testes). Objeto preservado cuja gravação do registro falhe depois (ex.: colisão de slug na corrida) pode permanecer órfão — é endereçado por conteúdo, escopado ao órgão e inofensivo; slug ocupado é detectado antes de armazenar.
6. Origem de registros legados fica `LEGACY_UNCLASSIFIED` até classificação humana; filtro por propriedade no catálogo é feito na aplicação (ver §8).
7. A política `OPTIONAL` só reduz a exigência de **evidência** sobre o **modelo**; conformidade jurídica do documento elaborado continua com a Procuradoria.

## 13. Pendências institucionais

- Owner: executar a checagem somente leitura pré-merge (§9.1) e autorizar o merge/deploy; o marco será o instante da aplicação da 0318.
- Cada órgão (e a Procuradoria): decidir se estabelece `REQUIRED` ou adota `OPTIONAL` para seus modelos (o órgão legado decide quando quiser).
- Autorizações D3–D6 da Revisão 2 (independentes desta entrega).

## 14. Testes

- Unitários de domínio (origem, política, camadas, hashes): `institutional-templates-governance-v2-domain.test.ts`.
- Integração MySQL real: `templates-governance-v2-mysql-smoke.test.ts` — POL-1..5 (compat, OPTIONAL, RBAC/CAS/idempotência/validação, piso elevado, TOCTOU), ORG-1..3 (origem inferida, upload malicioso/inerte e falha de storage, imutabilidade/legado), DER-1..2 (lineage, replay, concorrência, tenant cruzado, fluxo completo sem parecer prévio, Rev1/vínculo intactos).
- UX: `templateGovernanceV2-components.test.ts`.
- **Hardening final:** `institutional-templates-governance-v2-hardening.test.ts` (config do marco fail-closed; `explainIntegrity` em todos os cenários; adapter de originais — chave por órgão, readback, falhas, idempotência, reverificação, `FORBIDDEN_KEY`) e, no smoke MySQL: POL-1 (padrão `OPTIONAL` × `LEGACY_COMPAT` × decisão explícita × transição × isolamento entre órgãos), POL-2 reproduzindo o cenário Rev1/Rev2/vínculo num órgão legado, ORG-4 (sem storage, não verificado, falha — zero efeitos; idempotência; concorrência 4×; integridade; reverificação; multi-tenant; derivada de upload).
