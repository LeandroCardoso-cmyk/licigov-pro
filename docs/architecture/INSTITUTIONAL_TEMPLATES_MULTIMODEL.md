# Modelos Institucionais — Multi-modelo, escopo exato e fontes canônicas (Lane A)

> Contexto: piloto do Edital. Feature flag `FF_INSTITUTIONAL_TEMPLATES_V1` permanece **OFF**. Nada aqui registra modelo real,
> toca processo real ou ativa o fluxo em produção. "BLL" **não** é engine: é **configuração/aplicabilidade** de um modelo.

## 1. Escopo exato do binding

`BindingScope` tem cinco chaves, todas opcionais e comparadas por **igualdade exata** (ausente só casa com ausente):

| chave | natureza | exemplo |
|---|---|---|
| `modality` | modalidade | `pregao`, `concorrencia` |
| `form` | forma de realização (slug) | `eletronico`, `presencial` |
| `platform` | plataforma (slug **extensível**, sem enum fechado) | `bll`, `licitanet`, `portal-compras-publicas` |
| `regime` | regime de execução | — |
| `criterion` | critério de julgamento | — |

Regras: sem curinga, sem fuzzy, sem "mais específico vence", sem "último", sem IA, sem fallback. Escopo diferente ⇒ `NOT_BOUND`;
dois ativos no mesmo escopo exato ⇒ `AMBIGUOUS`. A **mesma revisão PUBLISHED** pode ter vários bindings exatos (um por combinação).
Uma nova plataforma é apenas um novo binding — nunca um novo engine.

Slugs (`form`, `platform`): `[a-z0-9]+(-[a-z0-9]+)*`. `normalizeScopeSlug` só troca caixa e `_` por `-`; o que continuar inválido é
**recusado** (nunca "consertado"). Observação: o valor canônico da forma no produto é `eletronico` (o exemplo `eletronica` do pedido
original é só rótulo de texto; o escopo usa o slug canônico).

## 2. Migration `0317_institutional_template_multimodel_scope`

Aditiva e replay-safe (procedimento com guardas `INFORMATION_SCHEMA`; precedente 0311/0313). Só toca tabelas **deste** bounded context:

- `institutional_template_bindings`: `scope_form`, `scope_platform` (`varchar(64) NOT NULL DEFAULT ''`);
  `active_scope_key` (coluna gerada STORED, `utf8mb4_bin`, `varchar(352)`) passa a incluir forma e plataforma;
  `UNIQUE(organization_id, active_scope_key)` (`uq_itb_active_scope`) vale sobre o escopo **completo**.
- `institutional_template_identities`: `display_name varchar(160) NOT NULL DEFAULT ''`.
- HD-26 preservado: nenhuma FK criada/alterada/removida; nenhum CASCADE; nenhum DDL em pai produtivo existente.
- Linhas existentes: forma/plataforma ficam `''` (nada inferido); a chave é recalculada pelo banco.
- Rollback lógico: colunas aditivas com DEFAULT (o build anterior as ignora). Reverter a chave exige DDL manual (não incluído).

Cobertura real (MySQL): `templates-0317-migration-mysql-smoke.test.ts` — fresh, 0316→0317 com dados, replay, estado parcial,
mesmo tenant (conflito/coexistência), cross-tenant, concorrência.

## 3. `displayName` da Identidade

Rótulo de **apresentação** (texto limpo, ≤160). Não é regra jurídica, não define aplicabilidade, não entra em hash. Gravado na
criação da identidade; `''` = ausente (a UX usa o slug). Sem metadados ornamentais.

## 4. Fontes canônicas (uma autoridade cada; nada inventado)

Catálogo `tpl-catalog/2` (13 fontes, `VariableSource2`). Cada fonte tem **uma** autoridade; fato do processo, política institucional,
normativo verificado e orçamento permanecem **separados**. `RESULT` não tem autoridade pré-certame: é omitida e os campos
pós-homologação ficam "a preencher" (nunca fabricados). `PARAMS` não existe no v2.

| Fonte | Autoridade | Observações |
|---|---|---|
| `PROCESS` | processo licitatório + campos governados | número/ano e `orcamentoSigilosoSimNao` são **derivados** (sigilo vem da decisão de divulgação) e não podem ser digitados |
| `IDENTITY` | identidade institucional (snapshot canônico) + extensão governada do órgão | também o fingerprint do M1 |
| `ITEMS` | **Itens da contratação canônicos** (HD-01) | quantidade = `plannedQuantity`; sem itens ⇒ `CANONICAL_ITEMS_REQUIRED`; `QUADRO_ITENS_CONTRATACAO` é `dataTable`; **valores só com orçamento público** (sigiloso/sem decisão ⇒ as chaves de valor nem existem) |
| `TR` / `DFD` / `ETP` | documento oficial `emitido` | geração exige **pin exato** (org + `documentId` + versão + `contentHash`); rascunho/outro tenant não servem; TR alterado depois do M1 ⇒ `SOURCE_CHANGED` |
| `CERTAME_CONFIG` | decisão humana registrada (campos governados do processo) | o LiciGov **não** cadastra o certame na BLL e não infere nada |
| `POLICY` | decisão humana do órgão (campos governados) | política institucional ≠ fato do processo |
| `BUDGET` | decisão `budget_disclosure` + estimativa canônica | `sigiloso` nunca expõe valor (texto, tabela, anexo, nome de arquivo, metadados, manifest) |
| `NORMATIVE` | reference set governado, ativo, verificado e do contexto correto | sem set verificado ⇒ falha fechada |
| `LIFECYCLE` | projeção do ciclo de vida do processo (0313) | — |

### Campos governados (`governed-fields/1`)

Dados que não pertencem a nenhum sistema canônico (parâmetros do certame, política do órgão, ênfases do processo) são **decisões
humanas** no ledger existente `institutional_decisions` (append-only, CAS por revisão, idempotência, `lockDecisionSubject`), nos
assuntos `procurement.source_fields` (processo) e `institutional.policy` (órgão). O payload `{sections:{FONTE:{caminho:valor}}}` é
validado contra o **catálogo da revisão** (tipos, enums, obrigatoriedade); caminhos de autoridade canônica são recusados. A leitura é
leniente com campos de outros catálogos (multi-modelo) e a escrita preserva os campos "estrangeiros". Os controles `decisao.*` são
decisões governadas e auditáveis, **nunca escolhidas por IA**.

## 5. Evidência da aprovação jurídica (única, no ledger existente)

Há **um** contrato de evidência (o de `TemplateGovernanceService.recordLegalEvidence`, em `institutional_decisions`, sem segundo
ledger): `sourceLogicalVersion`, `sourceSha256`, `revisionSemanticHash`, `recordedBy`, `recordedAt` e referências. O sistema não
inventa parecer, protocolo, data nem procurador; `DRAFT → APPROVED → PUBLISHED` continua obrigatório. `authorityValidation` permanece
`NOT_VALIDATED_POLICY_PENDING`; nenhuma IA decide.

## 6. Regras governadas do modelo (`tpl-model-rules/1`)

As SYSTEM NOTES do modelo viram validações explícitas e auditáveis (`models/<modelo>/rules.json`), avaliadas na geração **e** na
revalidação: `forbid` (ex.: maior desconto + orçamento sigiloso ⇒ `MODEL_RULE_VIOLATED`), `range`, `singleValue` (canal único),
`tableRange`, `durationMax`, `dateOrder`, `unavailable`. Quando a autoridade necessária não existe (ex.: justificativa de garantia
acima de 5%, divisibilidade do objeto para cota reservada, acréscimo de consórcio fora de 10–30%) e o cenário está ativo ⇒
`RULE_VALIDATION_UNAVAILABLE` (fail-closed). SYSTEM NOTES nunca são renderizadas.

## 7. Prontidão atômica na publicação (TPL-ED-PUB-TOCTOU-001)

A matriz de readiness (12 checks, incluindo `SOURCE_BACKING`) gera um **witness determinístico** (semanticHash da revisão, catálogo,
inventário, procedência, evidência jurídica, capacidades e `matrixHash`). Ele é revalidado **dentro da transação de publicação, com
o lock do assunto**: mudou ⇒ `READINESS_STALE` + rollback total; indisponível ⇒ `READINESS_UNAVAILABLE`. `BLOCKED` ⇒ zero decisão,
transição ou evento. O cliente nunca envia a matriz. `READINESS_GATED_KINDS = ["edital"]`.

## 8. Limitações conhecidas

- O prazo mínimo legal entre divulgação e abertura **não** é validado (responsabilidade da pessoa que decide).
- Cota reservada e garantia >5% / consórcio fora da faixa exigem autoridade ainda não modelada ⇒ bloqueiam a composição quando ativos.
- `codigoCatalogacao` (CATMAT/CATSER) é opcional: incluído quando confirmado.
- Segundo modelo: prova sintética (não produtiva) em `templates-edital-bll-e2e-mysql-smoke.test.ts` (E9); novos modelos entram como
  novas identidades/revisões/bindings, sem novo composer.

## 9. Fora de escopo

Modelo real em produção, processo real (2026/253), ativação da flag, deploy e merge.
