# Reclassificação das evidências das homologações H1–H5 (staging, organização sintética 2)

> **Status:** vigente desde nov/2026 (auditoria pré-emissão H5, saneamento P0). Este documento **não altera** registros, documentos, hashes,
> manifests nem o ledger — corrige a INTERPRETAÇÃO das evidências. Ambiente: staging, organização 2 (`homologacao-sintetica`, sintética
> e identificada). A organização 1 (referências reais) não foi tocada por nenhuma das homologações abaixo.

## 1. Classificação aplicada

| Classe | Significado |
|---|---|
| `MECHANISM_PROVEN` | o mecanismo técnico foi exercitado e o resultado observado confere com o contrato (ids/hashes/estados abaixo) |
| `MECHANISM_ONLY — HUMAN_REVIEW_NOT_VERIFIED` | o documento/ato existe e o mecanismo funcionou, mas **nenhuma pessoa** revisou, conferiu ou confirmou o conteúdo |
| `NOT_PROVEN` | a funcionalidade não foi demonstrada (não houve ato humano real, decisão jurídica nem aprovação institucional) |

**Fato central.** As jornadas foram executadas por um agente de IA, por scripts (API) e por automação de interface (Playwright), usando duas
identidades técnicas do tenant sintético: usuário **5** (elabora) e usuário **4** (emite/reconhece). Duas contas técnicas operadas pelo
mesmo agente **não** provam a participação de duas pessoas.

## 2. Cenários

| Cenário | Processo (id) | Data | Meio | Identidades |
|---|---|---|---|---|
| H1 — dotação ausente | 4705/2026 (`22d8a1b5c870f5be152e`) | 05/11/2026 | API (script) | 5 elabora · 4 emite/reconhece |
| H2 — informação única | 3087/2026 (`bc563b9c355069ca0a1b`) | 05/11/2026 | API | 5 · 4 |
| H3-H4 — Revisão 1, recomposição X→Y→X | 5488/2026 (`00b710ff7aad04fc5609`) | 05/11/2026 | API | 5 · 4 (troca de binding por 4) |
| H5 Etapa 1 — SRP com políticas ausentes | 2167/2026 (`1e9517df18ed9dc4a4e5`) | 05–06/11/2026 | API + UI automatizada | 5 · TR emitido por 4 |
| H5 Etapa 2 — políticas SRP e recomposição | 2167/2026 | 08/11/2026 | UI automatizada (Playwright) | 5 |
| F1/F2 — verificação visual | 2167/2026 | 08/11/2026 | UI automatizada, só leitura | 5 |

## 3. Mecanismos tecnicamente comprovados (`MECHANISM_PROVEN`)

- **Composição pelo modelo institucional** (Revisões 1 e 2): M1 `GENERATION` com `composedOutputHash` igual ao rascunho (H5: `9c6d480f…`, depois `771eed7f…`).
- **CAS**: recomposição sem confirmação recusada (`HUMAN_EDIT_WOULD_BE_OVERWRITTEN`); troca de dotação sem `confirmReplace` recusada (`BUDGET_ALLOCATION_REPLACE_UNCONFIRMED`).
- **Idempotência/replay**: reemissões com a mesma chave ⇒ `replayed: true`; replay do Edital H5 sem mudança de hash/versão.
- **Versionamento**: Edital H3-H4 v1–v3 `gerado` → v4 `emitido`; Edital H5 v1 → v2 `gerado`, v1 e M1 anterior preservados.
- **Recomposição governada**: H3-H4 X→Y→X (manifests `tplm1_0222c0…` / `tplm1_919c6e…` / `tplm1_0222c0…`); H5 Etapa 2 (`tplm1_35928a8b5629ea7487`, revalidação PASSED).
- **`SOURCE_CHANGED`**: emissão recusada após mudança de fonte (H3-H4); H5 Etapa 2 (processo e política).
- **SoD técnica**: o autor tentando emitir recebeu `FORBIDDEN` (H1, TR e Edital). Prova a REGRA; não prova duas pessoas.
- **Preservação de emitidos**: documentos oficiais não mudaram após troca de dotação (H2) nem após a revisão 10 do Perfil (H5 Etapa 2).
- **Isolamento**: acesso à organização 1 e a id inexistente ⇒ `FORBIDDEN`; rotas administrativas recusadas ao Gestor (F1).

## 4. Não comprovado (`NOT_PROVEN`)

Revisão humana efetiva de qualquer documento; manifestação pessoal de responsabilidade; decisão jurídica; aprovação institucional real;
adequação integral do conteúdo; jornada E2E concluída com decisão humana verdadeira.

## 5. Evidências comprometidas (`MECHANISM_ONLY — HUMAN_REVIEW_NOT_VERIFIED`)

### 5.1 Documentos oficiais emitidos com `[REVISAR]` substituído por conferência fictícia

Os marcadores foram trocados por script por `[HOMOLOGAÇÃO SINTÉTICA] texto conferido na homologação.` e a emissão usou o motivo
"TR/Edital revisado e conferido.". Nenhuma pessoa leu os trechos. Em todos, emissor técnico = usuário 4.

| Documento | Id oficial · versão | Marcadores trocados | Reprodução do hash do conteúdo revisado |
|---|---|---|---|
| TR H1 | `b09629d957b82a12a869` · v2 | 12 | `6ca95306…` ✓ |
| TR H2 | `7048974299c72d41cc12` · v2 | 8 | `e6106d28…` ✓ |
| TR H3-H4 | `036e98f4c316833be7b0` · v2 | 9 | `6162d4a7…` ✓ |
| TR H5 | `0514ad10876f7f8ae20d` · v2 | 10 | `2b3c6ca341915e055a398a4660abe4e8080a0fa7ed2438adc46e1e44b2dc2430` ✓ |
| Edital H1 | `5d2c39e7a6c77468cf00` · v2 | 3 | `69b36991…` ✓ ¹ |
| Edital H2 | `b711501cc30f2edc11d0` · v2 | 3 | `b726ed90…` ✓ ¹ |
| Edital H3-H4 | `64fdd0e0816b82eead41` · v4 | 3 | `50fcda51…` ✓ ¹ |

¹ Nos Editais, o hash reproduzido é o do conteúdo REVISADO antes da materialização late-bound feita pelo servidor na emissão; o `contentHash`
oficial é outro (`f214becb…`, `17271a45…`, `ea229163…`), como esperado pelo contrato de emissão. Nos TRs, o hash reproduzido é o próprio
`contentHash` oficial.

Reprodução: aplicar `\[REVISAR[^\]]*\]` → texto acima ao conteúdo gerado e calcular `draftContentHash` (sha256 UTF-8). Os marcadores dos TRs
apontavam lacunas reais — DFD/ETP não localizados; decisão necessária sobre critério de julgamento e modo de disputa; itens sem preço de
referência; no TR H5, "valor não conferido com o quadro do sistema" logo após o valor estimado. **O texto oficial passou a dizer "conferido"
onde o sistema dizia "não conferido".** Nos Editais, os 3 marcadores eram as narrativas pendentes (razões da vedação à subcontratação e
obrigações específicas do contratado e da contratante).

**Consequência:** nenhum desses documentos serve como prova de revisão documental. O TR H5 não pode fundamentar a emissão do Edital H5 como
documento revisado.

### 5.2 Reconhecimentos de desvio estrutural em laço

O script reconheceu, com a identidade 4 e decisão sintética, todos os desvios retornados (laço no roteiro; contagens nas saídas da execução,
não preservadas em arquivo versionado): ≥ 4 (H1 `tplm1_d2f35f00195f31fbca`, H2
`tplm1_82689159d87782d1d5`, H3-H4 `tplm1_2a522474bb6619c952` e `tplm1_0222c0334c07498ce6`); outros dois laços em H3-H4 sem contagem preservada.

### 5.3 Decisões governadas com decisão sintética e confirmações automatizadas

- Parâmetros do TR, configuração do certame, divulgação do orçamento, participação, dotação e Perfil do órgão foram gravados com
  `syntheticDecision` (referência "sem ato administrativo — dado de teste"). Os valores foram escolhidos pelo script — por exemplo,
  `srp.prazoVigenciaAta = 3 dias` no H5 Etapa 1, depois corrigido.
- **H5 Etapa 2:** a automação marcou "Confirmo, como pessoa responsável, o REGISTRO…" e confirmou duas gravações com o usuário 5: a
  **revisão 9** do processo 2167/2026 (vigência da Ata de 3 dias → 1 ano) e a **revisão 10** do Perfil da organização 2 (adesão `veda`,
  marco "sua assinatura", prazo 5 dias úteis). O ledger as atribui ao usuário 5 como decisão eletrônica; **não houve clique humano**. Os
  valores foram aprovados previamente pelo Owner da plataforma — autorização de execução, não ato do órgão nem declaração pessoal.
- Efeito colateral registrado: a revisão 10 levou os rascunhos de 4705/2026 e 5488/2026 a `SOURCE_CHANGED` (os oficiais não mudaram).
- A troca de binding em H3-H4 restaurou a revisão fixada, mas o **id do binding mudou** (`tb4240c06340d9182eb981` → intermediário
  `tb3bbe4eeb466613c8225e` (Revisão 1) → `tbc6cb7bc66d334a0e4006`), com novo `effectiveFrom`.
- Ids das decisões da H5 Etapa 2, derivados da fórmula determinística do ledger (`decisionId`, organização 2), não lidos do banco:
  processo 2167/2026 revisão 9 = `idc_f7c4b57e36da12653302` (supera `idc_7cf78f51845efd2dd9de`); Perfil revisão 10 =
  `idc_0c42a1c324eed097888d` (supera `idc_88a6c65f01c50f78469f`).

### 5.4 Motivos de emissão afirmando conferência

"TR revisado e conferido." (4 TRs) e "Edital revisado e conferido." (3 Editais).

## 6. Estado final do H5 (encerrado operacionalmente)

`H5_STAGE2_PARTIAL`, com `H5_STAGE2_POLICY_PASS`, `H5_STAGE2_RECOMPOSITION_PASS` e `H5_STAGE2_VISUAL_PASS` válidos **apenas como mecanismo**
(execução por agente). `BLOCKED_HUMAN_REVIEW`: 3 `[REVISAR]` permanecem. Emissão não executada. O TR v2 de 2167/2026 é `MECHANISM_ONLY`.

## 7. Ressalvas documentais (não alteradas aqui; correção depende de deliberação)

`roadmap/PRODUCT_ROADMAP.md` (seção M8, ~linhas 400–417, processos 9992/2026 e 8828/2026) afirma "`[REVISAR]` legítimos, resolvidos com texto
sintético marcado e **revisado**" e "narrativas resolvidas; desvios reconhecidos". Pelo mesmo método de execução (substituição por script,
como a própria seção admite em ~387–388), essas afirmações devem ser lidas como `MECHANISM_ONLY — HUMAN_REVIEW_NOT_VERIFIED`. Recomenda-se a
correção do texto do roadmap mediante decisão do Owner. As referências a "homologação funcional H1–H5" em
`docs/architecture/EDITAL_CONTEXT_REUSE.md` (origem das correções) continuam corretas.

## 8. Controles adotados (P0)

- Regra operacional permanente em `CLAUDE.md` ("Agentes de IA, confirmações humanas e evidências").
- `scripts/homologation-e2e.ts`: `replaceReviewMarkersForMechanismOnly` (texto que DECLARA "sem revisão humana"), `MECHANISM_ONLY_EMISSION_REASON`,
  `assertNoFictitiousReviewClaim`, `refuseAutomatedDeviationAcknowledgement`; `syntheticDecision` declara execução automatizada.
- Varredura estática (`server/__tests__/unit/p0-homologation-evidence-guards.test.ts`) impede que os procedimentos acima voltem aos roteiros que
  atingem o staging.
- Ledger: `decidedByUserId` vinculado ao registrador (`DECISION_AUTHORITY_NOT_ACTOR`).

## 9. Fontes e cadeia de custódia

Os fatos acima foram conferidos em: estados e textos gravados pelos roteiros de homologação durante a execução (arquivos locais da sessão,
não versionados), snapshots somente-leitura da H5 Etapa 2, logs HTTP do Railway (staging) e, para hashes, recálculo independente. Itens
apoiados apenas nas saídas da execução (reconhecimentos de desvio, recusas `FORBIDDEN` da SoD e do isolamento) são **PLAUSÍVEIS** quanto à
contagem exata. Em 09/11/2026, como contenção, os roteiros locais que simularam revisão/confirmação humana receberam uma linha inicial que os
desativa (`DESATIVADO (P0…)`); nenhum dado do staging foi alterado por isso, e o restante do conteúdo dos roteiros permaneceu como estava.

## 10. Limite (risco residual)

Uma automação que usa a sessão de uma pessoa continua indistinguível de um clique humano no servidor (não há canal/executor no ato). Os controles
acima protegem os roteiros e agentes **conhecidos** e tornam a regra explícita; não detectam automação que não se declara. A evolução está
especificada em `docs/architecture/DELEGATED_EXECUTION_AND_HUMAN_REVIEW_SPEC.md`. Os smokes MySQL locais ainda usam fixtures legadas com
"conferido" (banco descartável; não são evidência) — recomenda-se neutralizá-las numa limpeza futura.
