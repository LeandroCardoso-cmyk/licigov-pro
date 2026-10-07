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

| Fonte | Autoridade | Observações |
|---|---|---|
| `PROCESS` | processo licitatório | número, objeto, modalidade |
| `IDENTITY` | identidade institucional (snapshot canônico) | também o fingerprint do M1 |
| `ITEMS` | **Itens da contratação canônicos** (HD-01) | quantidade = `plannedQuantity`, nunca cotação/manual/IA; sem itens ⇒ `CANONICAL_ITEMS_REQUIRED`; item/lote, descrição, CATMAT/CATSER (se confirmado), unidade, quantidade, regime de participação (da `CERTAME_CONFIG`) e **valor só com orçamento público** |
| `TR` / `DFD` / `ETP` | documento oficial `emitido` | geração exige **pin exato** (org + `documentId` + versão + `contentHash`) igual ao vigente; nunca "o último" decidido pelo servidor; TR alterado depois do M1 ⇒ `SOURCE_CHANGED` |
| `CERTAME_CONFIG` | decisão humana `certame_configuration` (contrato fechado `certame-config/1`) | modo de disputa, datas/horas, decimais, intervalo mínimo, duração de etapa, regra de prorrogação, aberto/fechado, janelas operacionais. **O LiciGov não registra o certame na plataforma** |
| `POLICY` | decisões `institutional_policy` do órgão | política institucional ≠ fato do processo |
| `BUDGET` | decisão `budget_disclosure` + estimativa canônica | `sigiloso` nunca expõe valor |
| `NORMATIVE` | reference set governado, ativo e verificado | sem set verificado ⇒ falha fechada |
| `LIFECYCLE` | projeção do ciclo de vida do processo (0313) | — |
| `RESULT` | **sem autoridade** | falha fechada (documento pré-certame não tem resultado) |

Fato do processo, política institucional, normativo verificado e orçamento permanecem **separados**. Catálogo de variáveis: `tpl-catalog/2`
(corrente) ⊇ `tpl-catalog/1` (revisões antigas continuam resolvendo a v1). Ausência de fonte exigida ⇒ `MISSING_REQUIRED`;
fonte sem backing/corrompida ⇒ `TEMPLATE_SOURCE_UNAVAILABLE` (nunca omitida em silêncio).

## 5. Contrato de evidência da aprovação jurídica

Reusa o ledger existente (`institutional_decisions`, append-only, CAS por revisão, idempotência) — **sem segundo ledger**:
`decisionType = template_legal_approval`, `subjectType = institutional_template.legal_approval`, `subjectId = revisionId`,
`outcome ∈ {aprovado, reprovado}`, `evidence = [model-revision:…, semantic-hash:…, catalog:…, hash-version:…]`.

- O ato referencia o **hash semântico** da revisão e este deve coincidir com o persistido (conteúdo aprovado = conteúdo versionado).
- Número do parecer/protocolo (`basisReference`), data e autoridade são **informados por pessoa** (o piloto preenche); o sistema
  não inventa nenhum. `authorityValidation` permanece `NOT_VALIDATED_POLICY_PENDING`; nenhuma IA decide.
- Não altera snapshots congelados nem a revisão; é decisão **distinta** da aprovação/publicação do lifecycle.
- Leitura: `getLegalApprovalEvidence` informa a evidência corrente e se ainda corresponde ao conteúdo persistido.

## 6. Fora de escopo desta lane

Modelo real, processo real (2026/253), ativação da flag, deploy, merge, PR e Graphify.
