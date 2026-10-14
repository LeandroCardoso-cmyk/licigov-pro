# ADR-TG-V2 — Governança escalável de Modelos Institucionais (templates)

- **Status:** implementado na branch `feat/template-governance-v2`, aguardando revisão. Sem merge, sem deploy, sem migration.
- **Baseline:** `main` @ `c7ead2b6` (PR #293). Revisão 1 do Edital PUBLISHED e vinculada; Revisão 2 DRAFT (`trec9c3113392f420d5ec8`) — **nenhuma delas é tocada por esta mudança**.
- **Precedência:** [`PRODUCT_NORTH_STAR.md`](PRODUCT_NORTH_STAR.md). Complementa [`INSTITUTIONAL_TEMPLATES_MULTIMODEL.md`](INSTITUTIONAL_TEMPLATES_MULTIMODEL.md), [`EDITAL_PILOT_LANE_C.md`](EDITAL_PILOT_LANE_C.md) e [`INSTITUTIONAL_DECISION_CONTRACT.md`](INSTITUTIONAL_DECISION_CONTRACT.md).

## 1. Contexto e decisões de produto

O LiciGov Pro é uma camada cognitiva/operacional para **ELABORAR** documentos. Não é sistema de publicação oficial e não substitui a análise jurídica da Procuradoria, que acontece na fase institucional própria do documento.

1. **Publicar um modelo no catálogo interno ≠ publicar um documento oficial.** `PUBLISHED` numa revisão de template significa *disponível para elaboração* (`REVISION_PUBLISH_MEANING = TEMPLATE_CATALOG_PUBLICATION`). Não existe, e esta mudança não cria, mecanismo de publicação externa.
2. **Parecer jurídico prévio não é condição universal.** É obrigatório somente quando uma regra institucional o configura; opcional caso contrário; auditável quando registrado; nunca presumido; nunca fabricado por IA.
3. **Nenhum controle some em silêncio.** O padrão da plataforma permanece `REQUIRED` (comportamento atual). Mudá-lo é um ato explícito e separado (§8).
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
TemplateOrigin      = { ownership, source, lineage|null, original|null{sha256,sizeBytes,filename,storageKey|null}, declaredAuthor|null }
TemplateGovernancePolicy = { legalEvidence: REQUIRED|OPTIONAL, approveMinRole: manager|owner, publishMinRole: manager|owner }
TemplateGovernancePolicyKind = PLATFORM_DEFAULT | TENANT_DEFINED
ReadinessLayer      = TECHNICAL_TEMPLATE_READINESS | TENANT_TEMPLATE_POLICY | DOCUMENT_LEGAL_REVIEW
```

Regras: o cliente **nunca** declara `ownership`/`source` (inferidos pelo servidor a partir do tipo de origem do registro); piso de papel só pode ser **elevado** (≥ `manager`); política ausente ⇒ padrão da plataforma; política corrente **ilegível** ⇒ padrão ESTRITO (`REQUIRED`, `malformed: true`) — falha fechada.

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
| `REQUIRED` (padrão da plataforma) | **BLOCKED** (como antes) | PASS | **BLOCKED** (como antes) |
| `OPTIONAL` | NOT_APPLICABLE (explicado) | PASS (auditável) | NOT_APPLICABLE + aviso |

- **Anti-TOCTOU:** o witness agora inclui `policyDecisionId`; o commit da publicação relê a política dentro da transação. Mudar a política entre o cálculo e o commit ⇒ `READINESS_STALE`, nada gravado.
- **Compatibilidade de hash:** `matrixHash`/witness só incorporam o campo de política quando ela **não** é `REQUIRED`/ausente — hashes históricos e do padrão permanecem idênticos.
- `templatesProcedure` aplica o piso elevado pela política de forma **tenant-scoped**; a plataforma nunca aceita menos que `manager`.
- A política é gravada no ledger existente (`institutional.policy` / `institutional_policy` / `estabelecida`; assunto `template-governance-policy`): humano, confirmação explícita, autoridade declarada, justificativa, CAS por versão, idempotente, append-only.

## 5. Fluxo de templates do órgão (Fase C)

- **Plataforma:** pacotes aprovados versionados no servidor. `ownership = PLATFORM`.
- **Próprio:** upload (Markdown/DOCX) ou AST ⇒ `ownership = TENANT`, `source = TENANT_UPLOAD|TENANT_AUTHORED`.
- **Derivado:** `derivation.derive` copia uma revisão **já decidida** do órgão ou um pacote da plataforma para uma **nova identidade DRAFT no mesmo tenant** (`ownership = DERIVED`, `lineage` exato). A origem permanece imutável; derivar de DRAFT é recusado; revisão de outro tenant é indistinguível de inexistente.
- **Pipeline supervisionado do upload** (reaproveita `runImportPipeline`): upload → **SHA-256 calculado no servidor** → original preservado em `institutional-templates/{org}/originals/{sha256}-{nome-seguro}` (chave por conteúdo, escopada por órgão, nome sanitizado, sem travessia) → extração → normalização → mapeamento → validação (HTML cru, URL insegura e variável desconhecida são **recusados**; texto que imita instrução permanece texto inerte) → **revisão humana** → DRAFT → aprovação interna → disponibilização. Falha ao armazenar o original ⇒ `ORIGINAL_STORAGE_FAILED`, **nada é criado** (fail-closed). Sem storage configurado ⇒ `storageKey = null`, explícito.
- **Imutabilidade da origem:** gravada na procedência; alterar/remover é recusado (`ORIGIN_IMMUTABLE`); repetir é idempotente. Registros legados sem origem aparecem como `LEGACY_UNCLASSIFIED` e podem ser classificados **uma única vez**.
- **Idempotência/concorrência:** convergência pelo `slug`; N derivações idênticas simultâneas ⇒ 1 identidade, 1 revisão (espera limitada e determinística pelo estado transitório; nunca CONFLICT espúrio); mesmo slug com outra origem ⇒ `CONFLICT`.
- **Sem publicação automática** em nenhum ponto.

## 6. Superfície de API (tRPC, tenant-scoped)

| Rota | Papel mínimo | Observação |
|---|---|---|
| `governance.policy.get` | viewer | padrão, efetiva, histórico, nota |
| `governance.policy.record` | manager (`policy`) | humano + confirmação + CAS + idempotência |
| `derivation.derive` | operator (`register`) | humano + confirmação + idempotência |
| `registration.register` | operator | `declaredAuthor` opcional; origem inferida no servidor |
| `catalog.list` | viewer | `origin` + `originState` (`RECORDED`/`LEGACY_UNCLASSIFIED`/`MALFORMED`/`NO_PROVENANCE`) |
| `readiness.evaluate` | viewer | `layer` por verificação; `policy` aplicada |

## 7. Frontend (Fase D)

Catálogo com abas **Da plataforma · Da minha prefeitura · Derivados · Sem classificação** (contagens; "Todos" nunca esconde nada), selo de origem em cada card, ação **Derivar modelo** (só sobre revisão decidida; só com permissão), cartão **Política de governança** (leitura para todos; edição para gerentes; histórico; aviso de que não substitui a Procuradoria), diálogos de derivação e upload com nota de tratamento seguro, e matriz de prontidão **agrupada por camada** com a justificativa de cada bloqueio e a explicação do modo `OPTIONAL`. Lógica em funções puras (`institutionalTemplatesView.ts`) testadas sem jsdom.

## 8. Migrations — avaliação

**Nenhuma migration nesta entrega** (`pnpm db:generate` sem alterações). Política e origem usam o ledger append-only e a procedência existentes; o original usa o storage S3 existente.

Otimização futura **opcional** (não necessária hoje): colunas `ownership`/`source` em `institutional_template_identities` + índice, para filtrar o catálogo no banco em vez de decodificar a procedência. Exigiria migration aditiva (nullable, sem default destrutivo), backfill a partir do ledger e staging antes de produção. Não será aplicada em produção sem autorização do Owner.

## 9. Plano de rollout e transição

1. Revisão humana desta branch → merge autorizado → deploy (nenhuma migration, nenhum backfill).
2. Comportamento inicial **idêntico** ao atual em todos os órgãos (padrão `REQUIRED`).
3. Cada órgão pode, quando quiser, registrar sua política (gerente). Nenhum órgão é alterado por padrão.
4. Mudar o **padrão da plataforma** para `OPTIONAL` é decisão institucional separada: altera apenas `PLATFORM_DEFAULT_POLICY` (uma constante), com plano de transição aprovado pelo Owner, comunicação e nova rodada de testes. **Não feita aqui.**
5. Classificação de origem dos modelos legados: opcional, um a um, por quem tem permissão.

## 10. Compatibilidade — Revisão 1 / Revisão 2 / vínculo

- Rev1 (`tr71989200d5db4dbba576`, PUBLISHED) e o vínculo `tb1a3294cd0f2cb4509614` continuam fixados na revisão exata; testes provam que política, derivação e publicação de outros modelos não os alteram.
- Rev2 permanece DRAFT. A publicação dela continua sendo decisão humana distinta (D3–D6, com autorizações próprias do Owner); o padrão `REQUIRED` mantém a exigência de evidência jurídica enquanto o órgão não decidir o contrário.
- Processo protegido 2026/253: não tocado.

## 11. Segurança

Conteúdo de arquivo é **não confiável**: validação do pipeline existente, limites de tamanho/intake, nome sanitizado, chave de storage por conteúdo e por órgão, sem execução, sem interpretação de texto como instrução. Isolamento por tenant em todas as leituras/escritas (lock de assunto, `organization_id`). Ações de ator `ai`/`system` são recusadas (`HUMAN_ACTION_REQUIRED`). A IA nunca registra evidência jurídica, política, aprovação nem publicação.

## 12. Riscos residuais

1. **Edital próprio/derivado** depende de inventário/pacote para passar nas verificações técnicas de Edital; tipos fora de `READINESS_GATED_KINDS` (apenas `edital`) não são gateados por prontidão.
2. O `sourceSha256` de um upload continua **declarado** pelo usuário (procedência); o `origin.original.sha256` é o calculado no servidor. Ambos ficam registrados.
3. Sem storage configurado, o original não é preservado (`storageKey = null`, explícito) — operação deve garantir S3 em produção.
4. Origem de registros legados fica `LEGACY_UNCLASSIFIED` até classificação humana.
5. Filtro por propriedade no catálogo é feito na aplicação (volume atual baixo); ver otimização opcional (§8).
6. Política `OPTIONAL` só reduz a exigência de **evidência** sobre o **modelo**; conformidade jurídica do documento elaborado continua responsabilidade da Procuradoria.

## 13. Pendências institucionais

- Owner: decidir se/quando o **padrão da plataforma** passa a `OPTIONAL` (e política de transição).
- Owner/Procuradoria: definir, por órgão, se exigem evidência jurídica prévia de modelo.
- Autorizações D3–D6 da Revisão 2 (independentes desta entrega).

## 14. Testes

- Unitários de domínio (origem, política, camadas, hashes): `institutional-templates-governance-v2-domain.test.ts`.
- Integração MySQL real: `templates-governance-v2-mysql-smoke.test.ts` — POL-1..5 (compat, OPTIONAL, RBAC/CAS/idempotência/validação, piso elevado, TOCTOU), ORG-1..3 (origem inferida, upload malicioso/inerte e falha de storage, imutabilidade/legado), DER-1..2 (lineage, replay, concorrência, tenant cruzado, fluxo completo sem parecer prévio, Rev1/vínculo intactos).
- UX: `templateGovernanceV2-components.test.ts`.
