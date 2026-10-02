# Pacote de consulta jurídica — R4.2 / R8 (PR-18)

> Estado: **PREPARED_AWAITING_LEGAL_REVIEW** · branch `work/autonomous-semantic-remediation-r3-r11` · 2026-10-02.
> Documento **técnico**: descreve o que o sistema faz hoje e pergunta o que precisa ser decidido. **Não contém
> conclusão jurídica**, não presume parecer e não substitui a análise da Procuradoria/assessoria jurídica.
> Achados de origem: baseline `docs/audits/SEMANTIC_AUTHORITY_CROSS_MODULE_AUDIT.md` (inalterado).

## Como responder

Para cada item, a resposta precisa conter: (1) a decisão; (2) o fundamento (dispositivo e, se houver, orientação
interna/TCE); (3) a referência do parecer (nº/data) — é ela que muda a política correspondente de
`PENDING_LEGAL_REVIEW` para `VALIDATED` em `server/domain/legalReviewPolicy.ts`. Sem referência, o sistema continua
marcando a regra como **não validada**.

---

## J-1 · Competência para ratificar a contratação direta (R4.2 · SEM-004)

**O que o sistema faz agora (PR-07, local):** a ratificação é um registro no ledger append-only
`institutional_decisions` com decisão obrigatória (`ratificado` / `nao_ratificado`), **autoridade declarada**
(nome e cargo), data do ato, referência do ato (ex.: despacho) e justificativa. O usuário que registra
(`recordedBy`) é distinto da autoridade declarada (`decidedBy`). O papel técnico mínimo para registrar é `manager`.
O sistema grava `authorityValidation = NOT_VALIDATED_POLICY_PENDING`: **não verifica** se a pessoa declarada é a
autoridade competente.

**Perguntas:**
1. Qual cargo/função é a autoridade competente para ratificar dispensa e inexigibilidade no órgão (art. 72, VIII)?
   Varia por valor, por secretaria ou por delegação?
2. A ratificação pode ser registrada no sistema por servidor diferente da autoridade (registro de ato praticado
   fora do sistema)? Se sim, quais documentos comprobatórios devem ser anexados?
3. Há exigência de segregação de funções entre quem instrui o processo e quem ratifica?
4. Uma decisão "não ratificado" posterior a uma "ratificado" (superação) é juridicamente possível no mesmo processo
   ou exige novo processo? (Ligado ao NEW-028: o vocabulário de status do workspace não tem "não ratificado".)

## J-2 · Catálogo legal legado da contratação direta (SEM-010 · PR-19)

**O que o sistema faz agora:** o módulo legado `directContracts` aceita dois modos. No modo **governado**, a base
legal vem de um *reference set* aprovado (fail-closed enquanto não houver set ativo). No modo **legado**, usa o
catálogo `server/scripts/seedDirectContractLegalArticles.ts` e mapeia o teto de valor por *substring*
(`article.includes("75, I") ? "art75_i_a" : "art75_ii_outros"`). A auditoria aponta hipóteses da Lei 8.666 na
numeração da Lei 14.133 e incisos III/IV/VIII/XII/XIII recebendo o teto de R$ 100 mil. **Nada disso foi alterado**:
a criação legada agora registra na auditoria `legalCatalogPolicy = NOT_VALIDATED_LEGAL_POLICY_PENDING`.

**Perguntas:**
1. Confirmar o texto e o enquadramento corretos de cada inciso dos arts. 74 e 75 usados pelo órgão.
2. Os tetos de valor por inciso (art. 75, I e II, atualizados por decreto) — qual tabela vigente adotar e a partir
   de quando?
3. Registros já criados com o catálogo legado: precisam de revisão individual, de reenquadramento ou apenas de
   anotação? (Decisão de dados — nada será migrado sem esta resposta.)
4. O catálogo legado deve ser congelado para novos registros até a revisão?

## J-3 · Limites de aditivo no módulo legado de contratos (SEM-011 · PR-20)

**O que o sistema faz agora:** `server/services/contractValidation.ts` limita acréscimos a 50% do valor original
para **todo** contrato, compensa supressões com acréscimos e usa prazo-teto fixo de 120 meses; o novo total
informado pelo cliente sobrescreve o valor atual. Teste `auditCorrections.test.ts` protege os 50%. **Inalterado.**

**Perguntas:**
1. Quais percentuais do art. 125 se aplicam a cada tipo de objeto do órgão (obras, serviços, compras; reforma de
   edifício/equipamento)?
2. Acréscimos e supressões são calculados separadamente ou compensados entre si?
3. Qual o prazo máximo por tipo de contrato (arts. 105–114) que o sistema deve considerar?
4. O valor de referência do limite é o valor original atualizado (reajustes) ou o valor original nominal?

## J-4 · Limites dos aditivos canônicos (SEM-084 · PR-20)

**O que o sistema faz agora (PR-08/PR-17, local):** aditivos de valor/quantitativo exigem parecer e ficam
`aguardando_parecer` (status do contrato preservado); o termo é gerado a partir do aditivo registrado e traz
`[REVISAR: limites legais de valor/prazo do aditivo (art. 125) não verificados pelo sistema — política jurídica
pendente]`; o metadata do documento grava `addendumLimitPolicy = NOT_VALIDATED_LEGAL_POLICY_PENDING`. **Nenhum limite
é calculado ou imposto.**

**Perguntas:** as mesmas de J-3, aplicadas aos contratos canônicos; e se a verificação do limite deve **bloquear** o
registro do aditivo ou apenas **alertar** (com justificativa obrigatória para exceder).

## J-5 · Credenciamento e prompt do parecer legado (SEM-091)

**O que o sistema faz agora:** credenciamento não existe como regime na Contratação Direta canônica; o prompt do
parecer legado lê um campo `legalArticle` inexistente. A criação/edição pelo parecer legado está desligada (PR-03,
LEG-012); permanecem leituras.

**Perguntas:**
1. O órgão utiliza credenciamento (art. 79)? Com que frequência e para quais objetos?
2. Se sim, quais hipóteses (paralela e não excludente, seleção a critério de terceiros, mercados fluidos) e quais
   documentos mínimos devem compor o processo?

---

## O que fica bloqueado até as respostas

| Item | Bloqueio | Política em `legalReviewPolicy.ts` | PR |
|---|---|---|---|
| J-1 | BLOCKED_LEGAL_REVIEW (validação de competência) | — (`NOT_VALIDATED_POLICY_PENDING` no ledger) | PR-07 (implementado sem validar competência) |
| J-2 | BLOCKED_LEGAL_REVIEW + decisão de dados | `SEM-010_DIRECT_CONTRACT_LEGAL_CATALOG` | PR-19 |
| J-3 | BLOCKED_LEGAL_REVIEW | `SEM-011_LEGACY_ADDENDUM_LIMITS` | PR-20 |
| J-4 | BLOCKED_LEGAL_REVIEW | `SEM-084_CANONICAL_ADDENDUM_LIMITS` | PR-20 / R9 |
| J-5 | BLOCKED_LEGAL_REVIEW + decisão de produto | — | R10 (P2) |
