# LEGAL REFERENCE MANIFEST V1 (2026) — Lei nº 14.133/2021 · `BR-FEDERAL`

> **Estado:** `F-LEGAL1.2 — 50% — AUTHORITATIVE CONTENT MANIFEST READY` · conteúdo: `DRAFT VERIFIED CONTENT`.
> **Branch:** `claude/rebuild-licigov-pro-bFyTO` · **PR** #222 · **Produção:** A2 (intocada — A3-RD1 não toca produção).
> **Natureza do conteúdo:** o dataset jurídico é DRAFT VERIFIED (não ativo). A implementação do mecanismo
> (schema/installer/readiness) é a fase **A3-RD1** — o installer instala o set como `draft` (instalar ≠ ativar).
> **Contrato estrutural:** ver `../F_LEGAL1_1_AUTHORITATIVE_LEGAL_REFERENCE_CONTRACT.md` (§4.2 hash, §1.1 coverage, §3 temporal).
> **Fonte única machine-readable (A3-RD1):** `server/domain/legalReference/manifestV1.ts` — este `.md` é derivado/documental; o runtime, os testes e o CLI de hash consomem o módulo TS, sem duplicar o dataset.
> **Reprodutibilidade dos hashes:** `pnpm tsx server/scripts/legalReferenceManifestHashes.ts` (execução repetida = idêntica).
> **Correção A3-RD1 §1:** `Art. 74, IV` passa a `procurementType = inexigibilidade` (o enum do domínio é `dispensa|inexigibilidade`; a natureza de **credenciamento** fica na hipótese, sem ampliar o enum) — recalculados o `structuralContentHash` da entry e o `referenceSetContentHash`; `coverageManifestHash` inalterado (não depende de procurementType).

## 0. Verification method — `cross-environment-official-source-handoff`

A verificação do conteúdo jurídico **NÃO** foi feita por este ambiente (que não tem egress a `planalto.gov.br`)
e **NÃO** é memória do modelo nem snippet secundário. A verificação foi realizada em **ambiente externo
confiável conectado ao projeto**, que consultou **diretamente as fontes oficiais do Planalto**, e o resultado
foi entregue a este ambiente como **evidence handoff** pelo owner/orchestrator. Os `sourceUrl`/`sourceIdentifier`
oficiais são preservados; o `sourceHash` dos bytes remotos é `unavailable_in_current_environment` (nunca
fabricado). Os `structuralContentHash`/`referenceSetContentHash` são calculados normalmente sobre o **conteúdo
canônico local** (§7).

`verificationMethod = cross-environment-official-source-handoff`

### Fontes oficiais verificadas externamente
- **SOURCE A** — Presidência da República / Planalto — **Lei nº 14.133, de 1º de abril de 2021** (texto vigente).
  `sourceUrl`: https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm
- **SOURCE B** — Presidência da República / Planalto — **Decreto nº 12.807, de 29 de dezembro de 2025**
  (DOU 30/12/2025; vigência a partir de 2026-01-01; atualiza os valores da Lei 14.133/2021 e revoga o Decreto 12.343/2024).
  `sourceUrl`: https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12807.htm
- **SOURCE C** (apenas para temporalidade) — **Decreto nº 12.343, de 30 de dezembro de 2024** (vigente 2025-01-01,
  revogado pelo Decreto 12.807/2025). Explica a divergência 2025×2026 dos valores — **não é conflito, são vigências distintas**.

## 1. Coverage manifest V1 (autorizado)

- **law:** `Lei nº 14.133/2021` · **jurisdiction:** `BR-FEDERAL` · **scope:** `GLOBAL` · **version:** `1`
- **temporal coverage:** `effectiveFrom = 2026-01-01` · `effectiveTo = null` (aberto)
- **supportedLocators (7):** `lei-14.133-2021/art-74/inc-I`, `.../art-74/inc-II`, `.../art-74/inc-III`,
  `.../art-74/inc-IV`, `.../art-74/inc-V`, `.../art-75/inc-I`, `.../art-75/inc-II`
- **`coverageManifestHash` = `48ed92dc83799a9d70b94a3f70fd85abf03d76c9cde4ff36682e95d17e8e131c`**

Qualquer outro inciso do Art. 75 (ou qualquer locator fora da lista) → `UNSUPPORTED` **nesta versão** (não
significa inexistência do dispositivo; significa fora da cobertura institucional declarada da V1). Locator
dentro da cobertura mas ausente nos dados → `LEGAL_REFERENCE_NOT_FOUND` (defeito de dados).

## 2. Locators SUPPORTED (VERIFIED) — 7 entries

Todos: `law = Lei nº 14.133/2021`, `sourceAuthority = Presidência da República / Planalto`,
`sourceIdentifier = Lei nº 14.133, de 1º de abril de 2021`, `sourceUrl` = SOURCE A, `publicationDate = 2021-04-01`,
`effectiveFrom = 2026-01-01`, `effectiveTo = null` (a vigência da entry **deriva do set** — F-LEGAL1.1 §3.1),
`verificationStatus = VERIFIED`, `verificationMethod = cross-environment-official-source-handoff`,
`sourceHash = unavailable_in_current_environment`. Valor monetário **nunca** embutido na descrição estrutural
(vive em §3).

| canonicalDisplay | canonicalLocator | procurementType | hypothesisSummary (estrutural) | structuralContentHash |
|---|---|---|---|---|
| Art. 74, I | lei-14.133-2021/art-74/inc-I | inexigibilidade | Inviabilidade de competição: aquisição de materiais, equipamentos ou gêneros, ou contratação de serviços, que só possam ser fornecidos/prestados por produtor, empresa ou representante comercial **exclusivo**. | `ff0389a3736d1c88a6a022e328d3292443dec11770469ac9ba1150ea2d20c1d6` |
| Art. 74, II | lei-14.133-2021/art-74/inc-II | inexigibilidade | Contratação de profissional do setor **artístico**, diretamente ou por empresário exclusivo, consagrado pela crítica especializada ou pela opinião pública. | `3a30774265c62a3d952ae359bc180c604dac5cb27c7d64f1895243c605526004` |
| Art. 74, III | lei-14.133-2021/art-74/inc-III | inexigibilidade | **Serviços técnicos especializados** de natureza predominantemente intelectual, com profissional/empresa de **notória especialização** (inciso com alíneas); vedada para publicidade e divulgação. | `97312a3f27095eacc8dbc62a6ab2402070bc1fb8b7dec8cc57a5d9d3bdab5e70` |
| Art. 74, IV | lei-14.133-2021/art-74/inc-IV | inexigibilidade | Objetos que devam ou possam ser contratados por meio de **credenciamento** (natureza registrada na hipótese; `procurementType` = inexigibilidade — enum não ampliado nesta fase). | `e725972fe075069005d65bcd723d9e624ed966f5f3b60a3879c1efef2c5682de` |
| Art. 74, V | lei-14.133-2021/art-74/inc-V | inexigibilidade | Aquisição ou **locação de imóvel** cujas características de instalações e de localização tornem necessária sua escolha. | `a6282a6cbd5b335925cd2bb0b813f046dee9b28cb86c8cdfa0fb9be7d4f0fd02` |
| Art. 75, I | lei-14.133-2021/art-75/inc-I | dispensa | Dispensa **em razão do valor**: obras e serviços de engenharia **ou** serviços de manutenção de veículos automotores, até o limite vigente (valor em §3). | `40b4ace8581fb442924a8d3a28fa58dbe84492e41c6acfb89a4f31d080ad89a5` |
| Art. 75, II | lei-14.133-2021/art-75/inc-II | dispensa | Dispensa **em razão do valor**: outros serviços e compras, até o limite vigente (valor em §3). | `eca203b523578e10d07233c8700b2d5ac930786db81be165d3e062b4a75bb6fb` |

## 3. Value overrides (VERIFIED) — 2 overrides · Decreto nº 12.807/2025

Ambos: `sourceAuthority = Presidência da República / Planalto`,
`sourceIdentifier = Decreto nº 12.807, de 29 de dezembro de 2025`, `sourceUrl` = SOURCE B,
`publicationDate = 2025-12-30`, `effectiveFrom = 2026-01-01`, `effectiveTo = null`, `verificationStatus = VERIFIED`,
`verificationMethod = cross-environment-official-source-handoff`, `sourceHash = unavailable_in_current_environment`.

| canonicalLocator | valueCents | valor (R$) | contentHash |
|---|---|---|---|
| lei-14.133-2021/art-75/inc-I | `13098420` | 130.984,20 | `3fd5421f893a5936ba8d83a36620c842d655b0fe11a84176064508bac8c9b485` |
| lei-14.133-2021/art-75/inc-II | `6549211` | 65.492,11 | `484b007cd0cbd6ce7ecb411e4692507289585fa38b0f5d60d2accd343b9234f1` |

Vigência anterior (2025, Decreto 12.343/2024 — **fora da cobertura V1**, registrada só para lineage temporal):
Art. 75, I = R$ 125.451,15; Art. 75, II = R$ 62.725,59. Não entram no set V1 (coverage começa em 2026-01-01).

## 4. Auditoria definitiva do seed legado (`server/scripts/seedDirectContractLegalArticles.ts`) — 10 entradas

Classificação agora com **fonte oficial** (via evidence handoff). O seed **não** é rodado, **não** vira migration,
**não** é editado nesta fase (seções 14–15 do handoff); as ações são o plano para A3-RD1.

| Locator (seed) | Classificação | Fonte / diferença | Ação (A3-RD1) |
|---|---|---|---|
| Art. 74, I | **INCOMPLETE** | Formulação legada não cobre o escopo vigente (inclusive **serviços**). | REPLACE |
| Art. 74, II | **SUPPORTED** (estrutural) | Profissional artístico — condiz com o texto vigente. | MIGRATE (sem copiar guidance operacional sem fonte) |
| Art. 74, III | **SUPPORTED** (estrutural) | Serviços técnicos/notória especialização — condiz. | MIGRATE (requiredDocuments/examples do seed **não** são norma) |
| Art. 74, IV | **INCORRECT** | Dispositivo vigente = **credenciamento**; seed atribui hipótese diferente. | REPLACE |
| Art. 75, I | **INCORRECT + OUTDATED + INCOMPLETE** | Mistura I e II; representação incorreta; valor antigo; impede distinção obras/engenharia/manutenção × compras/outros serviços. | REPLACE |
| Art. 75, III | **INCORRECT** (fora da cobertura V1) | Seed: emergência/calamidade; vigente: hipótese ligada a licitação anterior frustrada. | DROP / OUT_OF_V1_COVERAGE |
| Art. 75, IV | **INCORRECT** (fora da cobertura V1) | Seed: emergência/urgência; vigente: conjunto específico com alíneas. | DROP / OUT_OF_V1_COVERAGE |
| Art. 75, VIII | **INCORRECT** (fora da cobertura V1) | Seed: imóvel; vigente: emergência/calamidade. Imóvel está hoje no **Art. 74, V**. | DROP / OUT_OF_V1_COVERAGE (sem remapeamento automático) |
| Art. 75, XII | **INCORRECT** (fora da cobertura V1) | Seed: instituição de pesquisa/ensino; vigente: transferência de tecnologia p/ o SUS. | DROP / OUT_OF_V1_COVERAGE (sem remapeamento automático) |
| Art. 75, XIII | **INCORRECT** (fora da cobertura V1) | Seed: resíduos/cooperativas; vigente: profissionais p/ comissão de avaliação técnica. | DROP / OUT_OF_V1_COVERAGE (sem remapeamento automático) |

**Ausente no seed:** Art. 75, II (dispensa — outros serviços e compras) → **CREATE** no novo reference set (não no seed).

## 5. Princípio — requiredDocuments NÃO são norma

Os arrays `requiredDocuments`/`examples` do seed **não** são conteúdo jurídico autoritativo. A reference entry
autoritativa contém apenas a **hipótese normativa verificada**. Checklists/documentação operacional só entram se
tiverem **fundamento oficial e source lineage próprios**, ou permanecem em camada operacional **não autoritativa**.
Nenhum exemplo/checklist do seed foi convertido em norma neste manifesto.

## 6. Approval contract (preservado)

Conteúdo nasce `DRAFT VERIFIED CONTENT` — **não** ativa automaticamente. Ativação (governança de **plataforma**,
federal, nunca de tenant) exige `approvedByUserId`, `approvedAt`, `approvalSource`,
`approvedReferenceHash` (= `referenceSetContentHash` no momento do aprovar). Após aprovado: coverageManifest,
entries, overrides, source lineage e hashes são **imutáveis** (F-LEGAL1.1 §3.1/§4). Estado atual: **não aprovado**.

## 7. Hash contract & set hash

- Algoritmo canônico: F-LEGAL1.1 §4.2 (SHA-256 / UTF-8 NFC / canonical JSON / chaves+arrays ordenados / sem
  espaços / `null` explícito / centavos inteiros / ISO-8601; lifecycle mutável e `verificationStatus`/`sourceHash`
  **excluídos** do hash).
- Objetos canônicos e cálculo: `docs/ops/legal-reference/legal_reference_manifest_v1_2026.hash.mjs` (reprodutível;
  execução repetida → saída idêntica).
- **`referenceSetContentHash` = `332a9cb3ff8477eddc5cf94790a13d7ea9bd7a8c5855078f7f567f5400196832`**
  (sela `{law, jurisdiction, scope, version, coverageManifest, entries[7], overrides[2]}`).
- `sourceHash` (bytes das páginas oficiais remotas) = `unavailable_in_current_environment` (não fabricado).

## 8. Invariantes atendidas (gates de conteúdo)

- 7 locators SUPPORTED, todos `VERIFIED`; 2 value overrides, ambos `VERIFIED`.
- Nenhum `UNVERIFIED` dentro do `coverageManifest`.
- Temporal overlap = **zero** (janela única `[2026-01-01, null)`; sem sobreposição de set/override).
- Nenhum valor monetário embutido em `hypothesisSummary`/description (valores só em §3).
- Nenhum `requiredDocument`/exemplo tratado como norma (§5).
- Source lineage completo (authority + identifier + url + publicationDate) em todas as entries/overrides.
- Hashes estruturais/set reprodutíveis (§7).
- Approval contract preservado (§6); conteúdo `DRAFT VERIFIED`, não ativo.

## 9. Classificação

`F-LEGAL1.2 = 50% — AUTHORITATIVE CONTENT MANIFEST READY`.
Conteúdo `DRAFT VERIFIED` (não ativo). **Não** iniciar A3-RD1. **Não** implementar schema/migration/seed/runtime.
Produção intocada. Próxima fase (não agora): `A3-RD1 — Reference Data Initialization & Readiness`.
