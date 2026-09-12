# F-LEGAL1.1 — Authoritative Legal Reference Contract & Temporal Model

> **Estado:** `25% — CONTRACT HARDENED` · **Slice de F-LEGAL1** (promovida a **dependência BLOQUEANTE da Phase A3**).
> **NÃO implementar sem nova autorização.** Este documento é APENAS o CONTRATO/plano — nenhum schema,
> migration, reference data, runtime ou serviço cognitivo foi alterado.
> HEAD de referência: `acaf297b` · branch `claude/rebuild-licigov-pro-bFyTO` · PR #222 · produção A2.
>
> **Endurecimento F-LEGAL1.2 (docs-only) aplicado** — este contrato foi reforçado em 6 pontos antes da
> autoria do conteúdo verificado: (A) **coverageManifest** determinístico no set (§1.1) participante do hash;
> (B) **append-only por INSERT/no-op/fail-closed**, nunca update silencioso (§4.1, substitui o antigo
> `ON DUPLICATE KEY UPDATE` de conteúdo); (C) **canonical content hashing** byte-a-byte reproduzível (§4.2);
> (D) **temporal overlap fail-closed** com resolução de exatamente-um (§3); (E) **lifecycle coerente das
> entries** (§3.1); (F) **escopo `GLOBAL / BR-FEDERAL`** do reference set (§0.1).

## 0. Fronteira de responsabilidade

- **F-LEGAL1 (conteúdo/autoridade jurídica):** quais dispositivos, texto, hipótese, fonte oficial,
  vigência, valores, cobertura. **F-LEGAL1.1** = contrato/modelo; **F-LEGAL1.2** = autoria do conteúdo verificado.
- **A3-RD1 (mecanismo técnico):** schema, migration determinística/idempotente, instalação do
  reference set, readiness, parity, rollback, testes MySQL, aposentadoria do seed manual.

A identidade e o conteúdo jurídico **nunca** vêm da memória do modelo. Fonte = Lei 14.133/2021 vigente
e atos oficiais de atualização (ex.: Decreto 12.807/2025). Sem fonte confiável em sessão → `UNVERIFIED`.

### 0.1 Escopo institucional do reference set — `GLOBAL / BR-FEDERAL` (endurecimento F)

O reference set da Lei nº 14.133/2021 é **federal e global** — jurisdição `BR-FEDERAL`, **NÃO** pertence a
nenhum tenant municipal. É governança da **plataforma**, não do órgão. O tenant entra apenas no **consumo**
(nunca na autoria/aprovação do set): a execução de `DIRECT_PROCUREMENT_REASONING` registra
`tenantId`, `actor`, `correlationId`, `task`, `resolvedReferenceSetVersion`, `resolvedLocator`,
`resolvedOverride`. Normas municipais/estaduais futuras são **outro domínio/overlay** (fora de V1) —
nunca misturadas ao set federal. Portanto o set carrega `jurisdiction = "BR-FEDERAL"` e `scope = "GLOBAL"`;
não há coluna `tenantId` em `legal_reference_set`/`legal_reference_entry`/`legal_value_override`.

## 1. Modelo recomendado (3 tabelas governadas NOVAS — aditivas)

Domínio de referência jurídica **separado** da tabela legada `direct_contract_legal_articles`:

1. **`legal_reference_set`** — conjunto VERSIONADO e aprovável:
   `id, law ("14.133/2021"), jurisdiction ("BR-FEDERAL"), scope ("GLOBAL"), version (int),
   status (draft|active|superseded), coverageManifest (json), coverageManifestHash, sourceAuthority,
   sourceIdentifier, contentHash, effectiveFrom, effectiveTo NULL, approvedByUserId, approvedAt,
   approvalSource, approvedReferenceHash, createdAt`.
   Invariante: no máximo **um** set `active` resolvível por data (ver §3, resolução exatamente-um).
2. **`legal_reference_entry`** — NORMA ESTRUTURAL dentro de um set:
   `id, setId, law, article, inciso NULL, alinea NULL, canonicalLocator, procurementType
   (dispensa|inexigibilidade|credenciamento), hypothesisSummary, description, requiredDocuments (json),
   coverageStatus (supported|unsupported), sourceAuthority, sourceIdentifier, contentHash`.
   **UNIQUE (setId, canonicalLocator).**
3. **`legal_value_override`** — VALOR TEMPORAL desacoplado da norma:
   `id, canonicalLocator, valueCents, effectiveFrom, effectiveTo NULL, sourceAuthority
   (ex.: "Decreto 12.807/2025"), sourceIdentifier, contentHash`.

Valor monetário **nunca** embutido em `description`/`summary` permanente — vive só em `legal_value_override`.

### 1.1 Coverage manifest determinístico (endurecimento A)

`coverageStatus` por entry **não basta**: um locator só ausente não distingue "defeito de dados" de
"fora de escopo". O `legal_reference_set` carrega um **`coverageManifest` determinístico** que declara,
de forma fechada, exatamente o que o set **pretende** cobrir. Forma mínima:

```
coverageManifest = {
  law: "14.133/2021",
  jurisdiction: "BR-FEDERAL",
  supportedLocators: [ "lei-14.133-2021/art-74/inc-I", "lei-14.133-2021/art-75/inc-I", ... ], // canônicos, ordenados
  temporal: { effectiveFrom: "2026-01-01", effectiveTo: null }
}
```

Regra de resolução com o manifest (fail-closed, sem "mais próximo"):
- locator **∈ supportedLocators** e **presente** nas entries → resolvido;
- locator **∈ supportedLocators** e **ausente** nas entries → `LEGAL_REFERENCE_NOT_FOUND` (defeito de dados);
- locator **∉ supportedLocators** → `LEGAL_REFERENCE_UNSUPPORTED` (fora da cobertura declarada, não é defeito).

O `coverageManifest` **participa do `contentHash` do set** (via `coverageManifestHash`, canonicalizado como em
§4.2). Assim, cobertura e conteúdo são selados juntos: qualquer alteração de cobertura muda o hash e exige
**nova versão** de set (§4.1), nunca edição in place.

### Alternativas rejeitadas
- **Estender `direct_contract_legal_articles` in place** (add colunas version/effective/source + child de valores): **rejeitado** — a tabela é consumida por todo o domínio legado de contratação direta (`contractValidation`, `proposalGenerator`, `directContractDocuments`, etc.); alterá-la acopla governança nova a linhas legadas ungoverned e dificulta "um set ativo" + resolução temporal + aprovação.
- **Tabela única mega-desnormalizada** (version+temporal+valor por linha): **rejeitado** — impede transição de versão atômica, duplica lineage por linha e complica a resolução "vigente em X".

## 2. Canonical locator (reutiliza `server/domain/legalArticleLocator.ts`)

Identidade determinística, **nunca** dependente de display textual:
`{ law: "14.133/2021", article: "75", inciso: "II" | null, alinea: "a" | null }`
→ locator canônico ex.: `lei-14.133-2021/art-75/inc-II`. Display é **derivado** (`formatLegalArticleLocator`).
Nunca armazenar `"Art. 74, I I"`; nunca usar fuzzy como identidade.

## 3. Contrato temporal (responde "qual regra vigia na data X?") — resolução exatamente-um (endurecimento D)

Resolução em 3 passos, **fail-closed** em cada um. Em cada passo, a data X deve resolver **EXATAMENTE UM**
registro — nem zero, nem dois:
1. **Set** `active`/aplicável cujo intervalo `[effectiveFrom, effectiveTo)` contém X (semiaberto;
   `effectiveTo NULL` = vigente/aberto). **0 sets** → `LEGAL_REFERENCE_VERSION_GAP` (gap);
   **≥2 sets** → `LEGAL_REFERENCE_TEMPORAL_OVERLAP` (ambíguo). Nunca "mais próximo", nunca "hoje".
2. **Entry** por `canonicalLocator` dentro do set (ver §1.1 para not_found vs unsupported).
3. **Value override** (quando o dispositivo tem valor) cujo período `[effectiveFrom, effectiveTo)` contém X.
   **0** → `LEGAL_VALUE_OVERRIDE_MISSING`; **≥2** → `LEGAL_REFERENCE_TEMPORAL_OVERLAP`.

**Invariante de não-sobreposição (verificável e selado no hash):** para um mesmo `(law, jurisdiction)` os
intervalos de sets nunca se sobrepõem; para um mesmo `canonicalLocator` os intervalos de overrides nunca se
sobrepõem. O intervalo é **semiaberto** `[from, to)` — a data de corte pertence ao período novo (o override
que entra em `2026-01-01` cobre `2026-01-01`; o anterior tem `effectiveTo = 2026-01-01`). A verificação de
não-sobreposição integra os gates de instalação (A3-RD1) e é condição de aprovação do set.

### 3.1 Lifecycle das entries (endurecimento E) — validade deriva do set

Para **menor complexidade**, a **entry NÃO tem lifecycle temporal próprio**: ela é **imutável** e sua
vigência **deriva integralmente do set** que a contém (o set carrega `status` + `[effectiveFrom, effectiveTo)`).
Não há `entry.effectiveFrom/effectiveTo` nem `entry.status`. Consequências:
- "desativar" uma norma estrutural = publicar **novo set** (nova version) sem aquela entry (append-only, §4.1);
- toda transição de vigência é uma transição **de set** (`draft → active → superseded`), auditável;
- o único dado temporal desacoplado é o **valor** (`legal_value_override`), porque valores mudam anualmente
  (art. 182) enquanto a norma estrutural não. Assim eliminamos o conceito ambíguo de "entry inativa".

## 4. Contrato de source lineage

Todo set/entry/override: `sourceAuthority` + `sourceIdentifier` + (quando houver) `sourceUrl` +
`publicationDate` + `contentHash` (sha256 do conteúdo canônico, §4.2) + `createdAt` + `approvedByUserId`/status.
Set só entra em `active` após **aprovação humana registrada** (`approvedByUserId`, `approvedAt`,
`approvalSource`, `approvedReferenceHash`). Aprovação é de **plataforma** (governança federal), nunca de tenant (§0.1).

### 4.1 Append-only por INSERT/no-op/fail-closed (endurecimento B — substitui upsert de conteúdo)

Conteúdo jurídico instalado é **imutável**. **NÃO** usar `ON DUPLICATE KEY UPDATE` para modificar conteúdo
jurídico já instalado (isso substitui o antigo §9.2 do plano). A instalação (A3-RD1) é regida por hash, não por update:
- **primeira instalação** de uma chave (`legal_reference_set` por `(law,jurisdiction,version)`;
  `legal_reference_entry` por `(setId, canonicalLocator)`; `legal_value_override` por
  `(canonicalLocator, effectiveFrom)`) → **INSERT**;
- **replay** com a **mesma chave + mesmo `contentHash`** → **NO-OP** (idempotente, replay-safe);
- **mesma chave + `contentHash` diferente** → **FAIL-CLOSED** (`LEGAL_REFERENCE_CONTENT_HASH_INVALID`);
  jamais sobrescreve silenciosamente;
- **mudança jurídica** (texto, cobertura, valor) → **NOVA VERSION** de set (nunca edição in place),
  seguida de aprovação e flip de `active`/`superseded`.

Assim a instalação é determinística e reproduzível entre local/CI/staging/production, e qualquer divergência
de conteúdo para uma chave já instalada **interrompe** em vez de corromper o histórico.

### 4.2 Canonical content hashing (endurecimento C)

O `contentHash` (e o `coverageManifestHash`) devem ser **reproduzíveis byte-a-byte** em local, CI, staging e
production. Especificação canônica **fechada**:
- algoritmo **SHA-256**, saída **hex minúsculo**;
- serialização **canonical JSON** em **UTF-8** (NFC), sem BOM;
- **chaves de objeto ordenadas** lexicograficamente por code point UTF-16 (ordem estável do `JSON.stringify` com keys ordenadas);
- **arrays de conteúdo ordenados** por chave canônica: `supportedLocators` e `entries` por `canonicalLocator`;
  `overrides` por `(canonicalLocator, effectiveFrom)`;
- **sem espaços** entre tokens (`separators (",",":")`);
- `null` representado explicitamente como `null` (nunca omitido; `effectiveTo` aberto = `null`);
- números inteiros sem casas decimais nem sinal de milhar; **valores monetários em centavos inteiros** (`valueCents`);
- datas em **ISO-8601 `YYYY-MM-DD`** (UTC, sem hora quando for data de vigência);
- **campos mutáveis de lifecycle EXCLUÍDOS do hash**: `id`, `status`, `createdAt`, `approvedByUserId`,
  `approvedAt`, `approvalSource`, `approvedReferenceHash` (o hash sela o **conteúdo**, não o estado de aprovação).

O `approvedReferenceHash` registrado na aprovação = o `contentHash` do set no momento do aprovar; readiness
recomputa e compara (fail-closed em divergência).

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

Detectar: set ausente; set não aprovado; catálogo vazio; locator inexistente **dentro** da cobertura
(`not_found`, defeito de dados) vs **fora** da cobertura declarada no coverageManifest (`unsupported`);
duplicidade semântica (`ambiguous`); gap temporal (`version_gap`) e **sobreposição temporal**
(`temporal_overlap`) de set/override; value override ausente quando exigido; source lineage ausente;
`contentHash`/`approvedReferenceHash` inválido. Resolução sempre **exatamente-um** (§3), nunca "mais próximo".

## 8. Observability contract (códigos diagnósticos estruturados)

`LEGAL_REFERENCE_SET_MISSING`, `LEGAL_REFERENCE_SET_NOT_APPROVED`, `LEGAL_REFERENCE_EMPTY`,
`LEGAL_REFERENCE_NOT_FOUND`, `LEGAL_REFERENCE_UNSUPPORTED`,
`LEGAL_REFERENCE_AMBIGUOUS`, `LEGAL_REFERENCE_VERSION_GAP`, `LEGAL_REFERENCE_TEMPORAL_OVERLAP`,
`LEGAL_VALUE_OVERRIDE_MISSING`, `LEGAL_REFERENCE_SOURCE_UNVERIFIED`, `LEGAL_REFERENCE_CONTENT_HASH_INVALID`.
Persistir tenant/correlation/task quando pertinente. Sem segredo/SQL cru.
(`LEGAL_REFERENCE_INACTIVE` foi **removido** — o endurecimento E (§3.1) elimina "entry inativa": a vigência
deriva do set, então gap/overlap de vigência já são cobertos por `VERSION_GAP`/`TEMPORAL_OVERLAP`.)

## 9. Migrations previstas (A3-RD1 — NÃO agora)

1. `CREATE TABLE legal_reference_set` / `legal_reference_entry` (UNIQUE `(setId, canonicalLocator)`) /
   `legal_value_override` — aditivas, MySQL strict, mirror em ensureSchema conforme convenção.
2. **Reference-data migration determinística/idempotente**: instala o set APROVADO (conteúdo de
   F-LEGAL1.2) por **INSERT/no-op/fail-closed regido por hash** (§4.1) — **nunca** `ON DUPLICATE KEY UPDATE`
   de conteúdo jurídico. Replay com mesmo hash = no-op; hash divergente para chave instalada = fail-closed.
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

`F-LEGAL1.1 = 25% — CONTRACT HARDENED`. Contrato reforçado (coverageManifest, append-only por hash,
canonical hashing, temporal overlap fail-closed, lifecycle de entry derivado do set, escopo BR-FEDERAL).
Não implementar schema/runtime sem nova autorização (isso é A3-RD1). A **autoria do conteúdo jurídico
verificado** (F-LEGAL1.2) depende de acesso às fontes oficiais — ver `LEGAL_REFERENCE_MANIFEST_V1_2026.md`.
