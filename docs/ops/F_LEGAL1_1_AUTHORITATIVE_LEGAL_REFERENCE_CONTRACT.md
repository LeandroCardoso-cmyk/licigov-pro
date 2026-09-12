# F-LEGAL1.1 — Authoritative Legal Reference Contract & Temporal Model

> **Estado:** `20% — FINAL PLAN READY` · **Slice de F-LEGAL1** (promovida a **dependência BLOQUEANTE da Phase A3**).
> **NÃO implementar sem nova autorização.** Este documento é APENAS o CONTRATO/plano — nenhum schema,
> migration, reference data, runtime ou serviço cognitivo foi alterado.
> HEAD de referência: `0291f4b` · branch `claude/rebuild-licigov-pro-bFyTO` · PR #222 · produção A2.

## 0. Fronteira de responsabilidade

- **F-LEGAL1 (conteúdo/autoridade jurídica):** quais dispositivos, texto, hipótese, fonte oficial,
  vigência, valores, cobertura. **F-LEGAL1.1** = contrato/modelo; **F-LEGAL1.2** = autoria do conteúdo verificado.
- **A3-RD1 (mecanismo técnico):** schema, migration determinística/idempotente, instalação do
  reference set, readiness, parity, rollback, testes MySQL, aposentadoria do seed manual.

A identidade e o conteúdo jurídico **nunca** vêm da memória do modelo. Fonte = Lei 14.133/2021 vigente
e atos oficiais de atualização (ex.: Decreto 12.807/2025). Sem fonte confiável em sessão → `UNVERIFIED`.

## 1. Modelo recomendado (3 tabelas governadas NOVAS — aditivas)

Domínio de referência jurídica **separado** da tabela legada `direct_contract_legal_articles`:

1. **`legal_reference_set`** — conjunto VERSIONADO e aprovável:
   `id, law ("14.133/2021"), version (int), status (draft|active|superseded), sourceAuthority,
   sourceIdentifier, contentHash, effectiveFrom, effectiveTo NULL, approvedByUserId, createdAt`.
   Invariante: no máximo **um** set `active` resolvível por data.
2. **`legal_reference_entry`** — NORMA ESTRUTURAL dentro de um set:
   `id, setId, law, article, inciso NULL, alinea NULL, canonicalLocator, procurementType
   (dispensa|inexigibilidade|credenciamento), hypothesisSummary, description, requiredDocuments (json),
   coverageStatus (supported|unsupported), sourceAuthority, sourceIdentifier, contentHash`.
   **UNIQUE (setId, canonicalLocator).**
3. **`legal_value_override`** — VALOR TEMPORAL desacoplado da norma:
   `id, canonicalLocator, valueCents, effectiveFrom, effectiveTo NULL, sourceAuthority
   (ex.: "Decreto 12.807/2025"), sourceIdentifier, contentHash`.

Valor monetário **nunca** embutido em `description`/`summary` permanente — vive só em `legal_value_override`.

### Alternativas rejeitadas
- **Estender `direct_contract_legal_articles` in place** (add colunas version/effective/source + child de valores): **rejeitado** — a tabela é consumida por todo o domínio legado de contratação direta (`contractValidation`, `proposalGenerator`, `directContractDocuments`, etc.); alterá-la acopla governança nova a linhas legadas ungoverned e dificulta "um set ativo" + resolução temporal + aprovação.
- **Tabela única mega-desnormalizada** (version+temporal+valor por linha): **rejeitado** — impede transição de versão atômica, duplica lineage por linha e complica a resolução "vigente em X".

## 2. Canonical locator (reutiliza `server/domain/legalArticleLocator.ts`)

Identidade determinística, **nunca** dependente de display textual:
`{ law: "14.133/2021", article: "75", inciso: "II" | null, alinea: "a" | null }`
→ locator canônico ex.: `lei-14.133-2021/art-75/inc-II`. Display é **derivado** (`formatLegalArticleLocator`).
Nunca armazenar `"Art. 74, I I"`; nunca usar fuzzy como identidade.

## 3. Contrato temporal (responde "qual regra vigia na data X?")

Resolução em 3 passos, **fail-closed** em cada um:
1. **Set** `active`/aplicável cujo `[effectiveFrom, effectiveTo)` contém X (effectiveTo NULL = vigente).
2. **Entry** por `canonicalLocator` dentro do set.
3. **Value override** (quando o dispositivo tem valor) cujo período contém X.
Sem set/entry/valor resolvível em X → recusa diagnosticada (não "hoje", não "mais próximo").

## 4. Contrato de source lineage

Todo set/entry/override: `sourceAuthority` + `sourceIdentifier` + `contentHash` (sha256 do conteúdo
canônico) + `createdAt` + `approvedByUserId`/status. **Append-only**: conteúdo novo = nova versão de
set (nunca reescrita in place). Set só entra em `active` após aprovação humana registrada.

## 5. Auditoria do dataset atual (`seedDirectContractLegalArticles.ts`) — 10 entradas

> Classificação com base **apenas** nos fatos normativos confirmados nesta sessão. Onde não há fonte
> oficial verificável em sessão → `UNVERIFIED` (NUNCA completar por inferência/memória do modelo).

| Locator (seed) | Tipo (seed) | Classificação | Problema / fonte necessária | Impacto |
|---|---|---|---|---|
| Art. 74, I | inexigibilidade | **UNVERIFIED** | "fornecedor exclusivo" plausível, mas sem confirmação oficial em sessão | médio |
| Art. 74, II | inexigibilidade | **UNVERIFIED** | "profissional artístico" — requer texto oficial | médio |
| Art. 74, III | inexigibilidade | **UNVERIFIED** | "serviços técnicos/notória especialização" — requer texto oficial | médio |
| Art. 74, IV | inexigibilidade | **INCORRECT** | Confirmado: Art. 74, IV = **CREDENCIAMENTO**. Seed diz "associação de pessoas com deficiência" → hipótese errada atribuída ao dispositivo | **alto** (base legal incorreta) |
| Art. 75, I | dispensa | **INCORRECT + OUTDATED + INCOMPLETE** | Confirmado: Art. 75, I = obras/serviços de engenharia **ou** manutenção de veículos automotores; valor R$ 130.984,20 (Decreto 12.807/2025, desde 01/01/2026). Seed **mistura** I e II num só registro, com valor **desatualizado** (R$ 100.000 hardcoded no texto e `valueLimit`) | **crítico** |
| Art. 75, II | — | **INCOMPLETE (AUSENTE)** | Confirmado: Art. 75, II = outros serviços e compras; valor R$ 65.492,11. **Não existe registro próprio** no seed | **crítico** |
| Art. 75, III | dispensa | **UNVERIFIED** | "emergência/calamidade" — requer texto oficial | médio |
| Art. 75, IV | dispensa | **UNVERIFIED** | "urgência" — requer texto oficial | médio |
| Art. 75, VIII | dispensa | **UNVERIFIED** | "imóvel" — requer texto oficial | baixo |
| Art. 75, XII | dispensa | **UNVERIFIED** | "instituição de pesquisa/ensino" — requer texto oficial | baixo |
| Art. 75, XIII | dispensa | **UNVERIFIED** | "resíduos sólidos/cooperativas" — requer texto oficial | baixo |

**Defeitos estruturais transversais:** não idempotente; sem unique semantic key (só PK id); valores
monetários embutidos em texto; `article` duplica o inciso ("Art. 75, I" + inciso "I"); seleção
incompleta; sem version/effective/source/lineage; auto-executa no import.

## 6. Cobertura V1 recomendada

**Catálogo PARCIAL governado é aceitável** para DIRECT V1, DESDE QUE: cobertura **declarada**; o sistema
distinga `unsupported` (fora da cobertura) de `not_found` (dentro da cobertura, mas ausente → defeito de
dados); nunca sugira base fora da cobertura; nunca fabrique/aproxime artigo; exija validação humana;
exponha a limitação.

Recomendação de conteúdo V1 (a ser AUTORADO/verificado em F-LEGAL1.2, não aqui): priorizar os dispositivos
de **dispensa por valor** (Art. 75, I e II — os casos operacionais mais comuns) e **inexigibilidade**
(Art. 74) que forem **oficialmente verificáveis**. Dispositivos `UNVERIFIED` **não entram** no set
autoritativo até verificação oficial. Justificativa: o produto sugere base legal para contratação direta;
sugerir dispositivo não verificado/desatualizado é risco jurídico maior que declarar cobertura parcial.

## 7. Readiness contract (antes de `DIRECT_PROCUREMENT_REASONING`) — fail-closed

Detectar: set ausente; set não aprovado; catálogo vazio; locator inexistente (dentro da cobertura);
locator fora da cobertura (`unsupported`); locator inativo; duplicidade semântica; versão temporal não
resolvível na data; value override ausente quando exigido; source lineage ausente; contentHash inválido.

## 8. Observability contract (códigos diagnósticos estruturados)

`LEGAL_REFERENCE_SET_MISSING`, `LEGAL_REFERENCE_SET_NOT_APPROVED`, `LEGAL_REFERENCE_EMPTY`,
`LEGAL_REFERENCE_NOT_FOUND`, `LEGAL_REFERENCE_UNSUPPORTED`, `LEGAL_REFERENCE_INACTIVE`,
`LEGAL_REFERENCE_AMBIGUOUS`, `LEGAL_REFERENCE_VERSION_GAP`, `LEGAL_VALUE_OVERRIDE_MISSING`,
`LEGAL_REFERENCE_SOURCE_UNVERIFIED`, `LEGAL_REFERENCE_CONTENT_HASH_INVALID`.
Persistir tenant/correlation/task quando pertinente. Sem segredo/SQL cru.

## 9. Migrations previstas (A3-RD1 — NÃO agora)

1. `CREATE TABLE legal_reference_set` / `legal_reference_entry` (UNIQUE `(setId, canonicalLocator)`) /
   `legal_value_override` — aditivas, MySQL strict, mirror em ensureSchema conforme convenção.
2. **Reference-data migration determinística/idempotente**: instala o set APROVADO (conteúdo de
   F-LEGAL1.2) via `INSERT ... ON DUPLICATE KEY UPDATE` por `(setId, canonicalLocator)`; replay-safe.
3. Aposentadoria do `seedDirectContractLegalArticles.ts`.

## 10. Arquivos previstos (A3-RD1 — NÃO agora)

`drizzle/schema.ts` + novas migrations; `server/domain/legalArticleLocator.ts` (estender p/ law/alínea);
`server/db/legalReference.ts` (getters governados + resolução temporal); readiness/observability;
`server/services/legalFrameworkAssistant.ts` (consumir o set governado em vez de `getLegalArticles`);
retirar `server/scripts/seedDirectContractLegalArticles.ts`. Nenhum toque em produção/boot.

## 11. Estratégia de rollback

Sets append-only + versionados: rollback = reativar o set aprovado anterior (flip de status) ou
implantar a migration anterior; sem mudança destrutiva de dados; fail-closed se nenhum set aprovado.

## 12. Plano de testes (A3-RD1)

clean install; upgrade; replay/migração repetida (sem duplicação, unique locator); catálogo vazio;
locator ausente (not_found) vs fora de cobertura (unsupported); locator inativo; duplicidade semântica
(ambiguous); transição de versão + resolução temporal "vigente em X"; value override temporal
(R$ vigente em X); staging/production parity; MySQL strict; rollback/fail-closed; provenance/source lineage.

## 13. Ordem exata

**F-LEGAL1.2** (autoria/verificação oficial do conteúdo: Art. 74/75, valores, cobertura, lineage)
→ **A3-RD1** (mecanismo: schema + migration determinística + readiness + observability + retirar seed + testes MySQL)
→ **staging** (deploy + instalação do set aprovado)
→ **LIVE Direct** (prova final)
→ **fechamento A3**.

## 14. Classificação

`F-LEGAL1.1 = 20% — FINAL PLAN READY`. Não implementar sem nova autorização.
