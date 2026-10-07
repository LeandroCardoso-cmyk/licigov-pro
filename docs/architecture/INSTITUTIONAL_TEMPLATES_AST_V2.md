# Modelos Institucionais — `tpl-ast/2` + `tpl-catalog/2` + Compilador do Modelo-Mestre (Lane B)

> Status: **engine + modelo BLL compilado e provado estruturalmente** (paridade 160/157/3/48 sobre o Markdown aprovado, sha256
> `6795b2ab…7904`). Nada foi registrado em produção, nenhuma flag foi ativada, nenhum binding foi criado, nenhum deploy, nenhuma migration.
> Dados do modelo: `server/domain/institutionalTemplates/models/edital-pregao-eletronico-bll/` (ver o README de lá).

## 1. Princípio: motor genérico, modelos como dado

Nenhum módulo conhece modalidade, plataforma ou modelo. Um modelo novo é **nova identidade + nova AST + novo mapeamento de
catálogo + novos bindings exatos** — nunca um compositor novo. O modelo BLL será só *um* mapeamento (`tpl-master-mapping/1`).

## 2. Versionamento paralelo (replay v1 intacto)

| Contrato | Schema | Catálogo | Hash |
|---|---|---|---|
| v1 (inalterado) | `tpl-ast/1` | `tpl-catalog/1` | `tpl-hash/1` |
| v2 (novo) | `tpl-ast/2` | `tpl-catalog/2` | `tpl-hash/1` (mesma função; a AST v2 é só outro conteúdo) |

* `astVersions.ts` despacha: AST v1 ↔ catálogo v1; AST v2 ↔ catálogo v2; cruzamento ⇒ `CATALOG_FORMAT_MISMATCH`;
  `tpl-ast/N` desconhecido ⇒ `AST_VERSION_UNSUPPORTED`.
* O validador v1, o composer v1 e a semântica de hash v1 **não foram alterados** (movidos apenas helpers compartilhados
  para `composerShared.ts`/`composerRequirements.ts`, byte a byte). Goldens v1 travados em
  `institutional-templates-ast2-contract.test.ts` (semanticHash `70710e13…`, composedOutputHash `aeac129b…`,
  manifestHash `04290ce2…`, manifestId `tplm1_c9fa121ec8ad395742`, AST v1 vazia `4a3199ea…`, registro `tpl-catalog/1` com 12 variáveis).
* Persistência: `ast_json` (longtext) guarda qualquer versão e o hash é recomputado — **sem migration/schema nesta lane**.

## 3. AST v2

Nós: `heading`, `paragraph` (numerado + âncora), `list`, `table` (estática), **`dataTable`** (liga uma variável `table` do
catálogo por chave governada + esquema de colunas; nunca serializada como texto gigante), `section` (numeração `auto`/`none`),
`conditional`, **`choice`** (`exactly-one`/`at-most-one`), **`docRef`** (`EXACT_PINNED` + `role`/`order`/`label`; nunca "última"),
**`annex`** (id/role/order/título/conteúdo), `aiSlot`. Inline: `text`, `var`, `strong`, `em`, **`xref`**.

### Numeração e remissão cruzada
O composer v2 tem três passes: *expand* (condicionais/choices resolvidos) → *number* (**só o que foi renderizado**) →
*serialize* (xref resolvido). Seções `auto` e parágrafos `numbered` recebem número final **depois** da remoção dos blocos
condicionais; anexos recebem romano pela posição entre os renderizados, ordenados por `order` (não pela posição no AST).
`xref` para alvo não renderizado ⇒ **`XREF_TARGET_NOT_RENDERED`** (falha fechada — nunca número inventado). Jamais "item 15.4" literal.

### Variáveis de controle
`renderable=false` (ex.: `DATA_DIVULGACAO_PREVISTA`, `ORCAMENTO_SIGILOSO_SIM_NAO`, `UTILIZA_SRP`): servem a condição/`choice`/
`requiredWhen`, e **nunca** a texto (`CONTROL_ONLY_VARIABLE_RENDERED` na validação). `requiredWhen` torna o controle obrigatório
quando outro valor o exige; ele só é exigido se a AST o referencia (ex.: na condição do ramo).

### DSL condicional v2 (fechada)
`eq/ne/in/gt/gte/lt/lte/present/absent/and/or/not`, profundidade ≤ 4, operandos booleanos, enum validado contra o conjunto fechado,
comparadores só em tipos numéricos. Sem regex/função/eval/relógio/IA.

### Extensões exigidas pelo mestre real (aditivas, ainda `tpl-ast/2`)
* **Condicional e `aiSlot` inline** (`when`/`aiSlot` dentro de um parágrafo) — o mestre tem blocos no meio da frase e campos "Propõe" inline.
* **Numeração**: parágrafo `numbered: true` (decimal; `level` 1–3 → `1.4.` / `1.4.1.`), `"alpha"` (alínea automática `a)` / `b.1)`, sem lacuna quando uma
  alínea condicional some) e `"seq"` (`1\.`, ponto escapado para o Markdown não virar lista). Seção `style: "ordinal"` + `labelPrefix` ⇒ `CLÁUSULA DÉCIMA PRIMEIRA — …`.
  Seções e parágrafos de nível 1 compartilham o contador do escopo; cada anexo reinicia a numeração; títulos de seção em anexo têm nível 3.
* **Âncora repetida só em ramos excludentes** (choice / condicional×senão): o mestre repete `1.4`, `4.1`, `14.1` nas variantes; fora disso continua `ANCHOR_DUPLICATE`.
* **`dataTable.columns[].when`**: coluna condicional (valores estimados somem com orçamento sigiloso).
* **`controlRef`**: declara dependência de um controle (resolve, valida, entra no manifest) sem renderizar nada.
* **`absentText`** (catálogo): texto governado para valor opcional ausente (ex.: `a preencher`), no lugar da marca `[REVISAR…]`.
* **Duração em minutos.**

## 4. Catálogo v2

Tipos (17): `string text integer number boolean money percent date time datetime duration enum list table url cnpj document_ref`.
Fontes (13): `IDENTITY PROCESS ITEMS TR DFD ETP PARAMS` (existentes) + `BUDGET CERTAME_CONFIG POLICY NORMATIVE RESULT LIFECYCLE`
(novas; `PARAMS` não é saco genérico — fontes semânticas têm nome próprio). Valores são **normalizados, nunca "consertados"**
(dinheiro = centavos inteiros; data real; CNPJ com dígito verificador; duração `{amount, unit}`), e formatados pt-BR de forma
determinística (`R$ 30.600,00`, `5,5%`, `05/11/2026 às 09h30`, `12 meses`, `5 dias úteis`).

## 5. Compilador do Modelo-Mestre (`masterCompiler.ts`)

`Markdown aprovado + mapeamento governado + Catálogo v2  ⇒  TemplateAST2 + relatório de paridade + proveniência`

* **Determinístico**: sem relógio/aleatório/IA; mesma entrada ⇒ mesma AST e mesmo hash semântico.
* **Proveniência**: o `sha256` do snapshot é conferido (`SOURCE_HASH_MISMATCH` ⇒ nada compilado). O conteúdo aprovado não é alterado.
* **Dialeto como dado** (`MasterMapping.dialect`): placeholder, abertura/else/fechamento de bloco, nota do sistema, título/parágrafo
  numerado, item de lista são regex *do mapeamento* — o compilador não assume o formato real do arquivo.
* **Disposições de entrada**: `variable`, `control`, `aiSlot`, `dataTable`, `docRef` (os dois últimos e `aiSlot` só como parágrafo inteiro).
* **Condições**: tipo de bloco → `Cond2` por mapeamento declarativo; grupos exclusivos adjacentes viram `choice`; ramo alternativo
  vira `conditional.else`. **NOTAS DO SISTEMA** são só documentação/evidência (hash por linha): jamais executáveis, renderizadas
  ou interpretadas — mudar o texto de uma nota **não** muda a AST.
* **Remissões**: literal → âncora governada (contagem estrita); remissão literal sem mapeamento ⇒ `UNMAPPED_REMISSION`.
* **Gate de paridade** (`evaluateParityGate`) parametrizado por `expectations` do mapeamento (nenhuma contagem fixa no código):
  entradas mapeadas / renderizáveis / controles, 0 placeholders desconhecidos, 0 entradas sem ocorrência, tipos de condição
  mapeados = usados, blocos balanceados, notas renderizadas = 0, 0 remissões sem xref.
* **Dialeto real**: notas `[SYSTEM NOTE … ]` multilinha, `{{#X}}…{{/X}}` em bloco e inline (inclusive blocos que abrem com um título: a seção condicional vira
  irmã, não filha), seções/anexos/cláusulas condicionais, alíneas/sub-alíneas/sequência, títulos ordinais e em negrito numerados, separadores e títulos de
  scaffolding do arquivo-mestre (excluídos e contabilizados), remissões por contexto exato (`⟦ ⟧`) + varredura de remissão residual, citações externas explícitas,
  `guards` governados.
* **Auditoria de numeração** (`auditLiterals`): embute o rótulo literal do mestre; compondo com os mesmos blocos ativos, rótulo automático = literal e rótulo de
  remissão = literal (591 rótulos + 120 remissões no cenário completo, 0 divergências).
* **CLI offline**: `pnpm templates:compile-master --md … --sha256 … --mapping … --catalog … [--out dir]`.

## 6. Achado de fidelidade do DOCX (linhagem)

O DOCX congelado (sha256 `5927f257…38fa9`) tem o Anexo II (bloco `SE_MENOR_PRECO`) quebrado: o par de "$" em "Preço unitário (R$)" / "Preço total (R$)"
foi lido como matemática em linha (1 objeto OMML), sumiram os "$" e os espaços ("Preçototal(R)") e a tabela virou texto com barras. O snapshot é imutável e **não foi
alterado**. A AST deriva da semântica do Markdown e declara "(R$)" nas colunas monetárias (regra do compilador
`requireCurrencyInMoneyHeaders` ⇒ `DATATABLE_MONEY_HEADER_MISSING_CURRENCY`). O achado viaja no relatório de compilação
(`findings`), nunca na AST. O DOCX futuro é renderizado pelo Document Engine **a partir da AST**.

Durante esta lane foi encontrado e corrigido um defeito do renderer: `buildInstitutionalModel` **descartava tabelas Markdown em
silêncio** (DOCX/PDF institucionais). Agora a tabela é um bloco `table` do modelo e é renderizada (DOCX `w:tbl`; PDF em grade);
testes provam que `R$`, `(R$)` e o `|` escapado sobrevivem.

## 7. IA

IA só existe em `aiSlot` (campos "Propõe"). IA nunca controla condição, fonte, binding, regra jurídica, campo numérico
canônico, publicação, aprovação ou emissão. Toda narrativa entra com `humanAccepted=false` no M1 e exige aceite humano antes da emissão.

## 8. O que NÃO foi feito (follow-ups explícitos)

1. **Serviços v1-only**: geração/emissão por serviço falham fechadas para revisão `tpl-ast/2` (`TEMPLATE_AST_VERSION_UNSUPPORTED`)
   até existirem adapters canônicos das fontes novas (`BUDGET`, `CERTAME_CONFIG`, `POLICY`, `NORMATIVE`, `RESULT`, `LIFECYCLE`).
2. Workflow/router de importação (Lane C) continuam v1 (aceitam só `{{variavel}}`); seleção de catálogo v2 é follow-up.
3. Registro de `tpl-catalog/2` com as entradas BLL no `catalogRegistry` — decisão posterior (nesta lane o catálogo BLL é só dado versionado, NÃO registrado).
4. Renderização DOCX final do edital a partir da AST pelo Document Engine (esta lane só garante que o renderer não perde tabela/`R$`).

## 9. Bloqueio anterior — RESOLVIDO

O Markdown aprovado (sha256 `6795b2ab…7904`) e o DOCX congelado (`5927f257…38fa9`) foram entregues. O relatório de controle entregue é o **1.0.0** (não o 1.0.1
congelado, `a3601b21…7cd0`); foi usado só como dicionário de campos — os 160 nomes do MD coincidem com os dele (exceto `ID_BLL`, removido na 1.0.1).

Prova (compilação do MD aprovado): 160 entradas = 157 renderizáveis + 3 controles; 0 desconhecidas; 0 sem ocorrência; 0 marcações `{{ }}` residuais; 48 tipos de bloco em
80 blocos (2 inline), todos balanceados; 51 notas, 0 renderizadas; 58 remissões governadas (127 substituições), 0 remissões literais sem xref; hash da AST estável
entre compilações e com chaves do mapeamento reordenadas; reescrever todas as notas não altera a AST.

## 10. Pendências (follow-ups)

Ver o README do modelo: decisões a confirmar (32 `decisao.*`, esquemas de tabelas, enums, textos `a preencher`), regras de nota ainda não executáveis por desenho
(validações de sistema), adapters das fontes novas, workflow/seleção de catálogo v2 e registro `tpl-catalog/2`.
