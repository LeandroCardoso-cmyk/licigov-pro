# LEGAL REFERENCE MANIFEST V1 (2026) — Lei nº 14.133/2021 · `BR-FEDERAL`

> **Estado:** `F-LEGAL1.2 — BLOCKED — OFFICIAL SOURCE VERIFICATION REQUIRED`
> **Branch:** `claude/rebuild-licigov-pro-bFyTO` · **PR** #222 · **HEAD de referência:** `acaf297b` · **Produção:** A2 (intocada).
> **Natureza:** DOCS/CONTENT ONLY. Nenhum schema, migration, seed, runtime ou DB foi tocado.
> **Contrato estrutural:** ver `../F_LEGAL1_1_AUTHORITATIVE_LEGAL_REFERENCE_CONTRACT.md` (endurecido).

## 0. Por que BLOCKED (motivo factual do ambiente)

A autoria deste manifesto exige **texto oficial verbatim** de fontes oficiais federais (seção 28 do handoff:
Planalto / DOU / atos oficiais). **Neste ambiente, o proxy de egress bloqueia essas fontes:**

| Fonte oficial exigida | Resultado do acesso |
|---|---|
| `https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2021/lei/l14133.htm` (Lei 14.133/2021) | `EGRESS_BLOCKED` |
| `https://www.in.gov.br/web/dou` (Diário Oficial da União) | `EGRESS_BLOCKED` |
| `https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/d12807.htm` (Decreto de valores) | egress p/ planalto bloqueado |

A **WebSearch funciona**, mas retorna apenas **snippets sintetizados de fontes secundárias**, que são
**PROIBIDOS como autoridade** (seção 28: nada de blogs/cursos/sites comerciais/memória/inferência) e que,
além disso, **se contradizem** — prova concreta de que não podem ser usados:

- **Divergência de valor não resolvível sem fonte oficial (Art. 75, I e II — dispensa por valor, vigência 2026):**
  - Auditoria prévia registrada em F-LEGAL1.1 §5: **R$ 130.984,20** (inc. I) / **R$ 65.492,11** (inc. II).
  - Snippet de WebSearch (fonte secundária): **R$ 125.451,15** (inc. I) / **R$ 62.725,59** (inc. II).
  - As duas figuras **divergem**; nenhuma é autoridade oficial. Resolver exige o texto do **Decreto
    12.807/2025** (ou tabela oficial do Portal de Compras/DOU) lido verbatim.

Conforme seção 40 do handoff: **"Se faltar fonte essencial: PARE. Não inferir."** → nenhum conteúdo jurídico
foi inferido ou copiado de fonte secundária neste manifesto. Todos os locators abaixo estão `UNVERIFIED` e
**fora** da cobertura suportada até verificação oficial.

## 1. O que falta para desbloquear (execução externa)

Executar, em ambiente com egress liberado para `planalto.gov.br`/`in.gov.br`, a leitura verbatim de:

1. **Lei nº 14.133/2021 — Art. 74** (caput + incisos I–V: inexigibilidade; confirmar que **IV = credenciamento**).
2. **Lei nº 14.133/2021 — Art. 75, I e II** (caput + incisos: dispensa por valor).
3. **Decreto federal vigente de reajuste (art. 182)** que fixa os valores de dispensa **a partir de 01/01/2026**
   (indício: Decreto 12.807/2025) — para os `legal_value_override`.

Cada leitura deve capturar: `sourceAuthority`, `sourceIdentifier`, `sourceUrl`, `publicationDate`, texto
verbatim, e então preencher as seções 3–5 abaixo com `verificationStatus = VERIFIED` e `structuralContentHash`
(canonicalização de §4.2 do contrato). **Sem isso, permanece BLOCKED.**

## 2. Escopo declarado (a VERIFICAR — ainda não é autoridade)

- **Jurisdição:** `BR-FEDERAL` · **scope:** `GLOBAL` (não pertence a tenant — F-LEGAL1.1 §0.1).
- **Cobertura temporal V1 pretendida:** `effectiveFrom = 2026-01-01`, `effectiveTo = null` — **se** sustentada
  pelas fontes. Datas fora da cobertura → fail-closed (não "mais próximo").
- **Cobertura estrutural V1 candidata** (dispositivos que se PRETENDE verificar; **nada assumido**):
  - Art. 74 — hipóteses de inexigibilidade (preferir o artigo integral **se** verificável com segurança);
  - Art. 75, I e II — dispensa por valor (os dois casos operacionais mais comuns).
  - **Não** incluir demais incisos do Art. 75 só porque o seed legado os continha (seção 29).
- Fora dessa lista declarada → `UNSUPPORTED` (não `NOT_FOUND`).

## 3. Locators SUPPORTED (VERIFIED) — **vazio (BLOCKED)**

Nenhum locator entra como `SUPPORTED` sem verificação oficial. Assim que as fontes forem lidas, cada locator
verificado preenche esta tabela com os campos exigidos (seção 31):

`law · article · inciso · alinea · canonicalLocator · canonicalDisplay · procurementType · hypothesisSummary ·
sourceAuthority · sourceIdentifier · sourceUrl · publicationDate · effectiveFrom · effectiveTo ·
verificationStatus=VERIFIED · structuralContentHash`

_(Nenhuma linha — pendente de verificação oficial. Valores mutáveis NÃO entram aqui; ver §4.)_

## 4. Value overrides (VERIFIED) — **vazio (BLOCKED)**

Valores monetários de dispensa (Art. 75, I/II) são temporais e vivem **separados** da norma estrutural.
Campos exigidos por override (seção 32): `canonicalLocator · valueCents · effectiveFrom · effectiveTo ·
sourceAuthority · sourceIdentifier · sourceUrl · publicationDate · contentHash · verificationStatus`.

_(Nenhuma linha — a divergência 130.984,20 vs 125.451,15 (inc. I) e 65.492,11 vs 62.725,59 (inc. II)
permanece **NÃO RESOLVIDA**; exige o texto oficial do decreto de reajuste. Nenhum valor é asseverado aqui.)_

## 5. Auditoria definitiva do seed (`server/scripts/seedDirectContractLegalArticles.ts`) — status

A auditoria estrutural das 10 entradas está em F-LEGAL1.1 §5 e **permanece válida no plano estrutural**
(defeitos: não idempotente, sem unique semantic key, valores embutidos em texto, `article` duplica inciso,
seleção incompleta, sem version/effective/source/lineage, auto-executa no import).

A **classificação jurídica definitiva** de cada entrada (`SUPPORTED | INCORRECT | OUTDATED | INCOMPLETE |
OUT_OF_V1_COVERAGE | UNVERIFIED`) com **fonte oficial** (seção 33) fica **PENDENTE** — depende das mesmas
fontes bloqueadas. Até lá: **nenhuma** entrada do seed é promovida a `SUPPORTED`; o seed **não** é rodado,
**não** vira migration e **não** é editado (seções 17, 33). Art. 74, I e Art. 75, II **não** são inseridos
manualmente (seção 17).

## 6. Hash & approval contract

- **Canonical content hash:** SHA-256 / UTF-8(NFC) / canonical JSON / chaves e arrays ordenados / sem espaços /
  `null` explícito / centavos inteiros / datas ISO-8601 / lifecycle mutável excluído — spec fechada em
  F-LEGAL1.1 §4.2. Deve ser idêntico em local/CI/staging/production.
- **Approval contract:** conteúdo nasce `DRAFT VERIFIED CONTENT`; **não** ativa automaticamente. Ativação exige
  `approvedByUserId` (governança de plataforma, federal), `approvedAt`, `approvalSource`, `approvedReferenceHash`
  (= `contentHash` do set no aprovar). Após aprovado: coverageManifest/entries/overrides/lineage/hashes são
  **imutáveis** (F-LEGAL1.1 §3.1, §4).

## 7. Readiness futuro (A3-RD1 — NÃO agora)

O manifesto, uma vez VERIFIED e instalado (A3-RD1), permite detectar fail-closed:
`LEGAL_REFERENCE_SET_MISSING`, `_SET_NOT_APPROVED`, `_EMPTY`, `_NOT_FOUND`, `_UNSUPPORTED`, `_AMBIGUOUS`,
`_VERSION_GAP`, `_TEMPORAL_OVERLAP`, `LEGAL_VALUE_OVERRIDE_MISSING`, `_SOURCE_UNVERIFIED`, `_CONTENT_HASH_INVALID`.

## 8. Classificação

`F-LEGAL1.2 = BLOCKED — OFFICIAL SOURCE VERIFICATION REQUIRED`.
O endurecimento estrutural do contrato (F-LEGAL1.1 → `25% — CONTRACT HARDENED`) está concluído; a autoria do
conteúdo jurídico VERIFICADO está bloqueada por indisponibilidade de egress às fontes oficiais neste ambiente.
Retomar em ambiente com acesso a `planalto.gov.br`/`in.gov.br`, preenchendo §§3–5 com conteúdo verbatim
verificado. **Não** iniciar A3-RD1. **Não** inferir conteúdo. Produção permanece intocada.
