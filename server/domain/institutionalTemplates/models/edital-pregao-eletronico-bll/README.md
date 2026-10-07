# EDITAL_PREGAO_ELETRONICO_BLL — v1.0.1-draft (dados governados, NÃO cadastrado)

Mapeamento, catálogo v2 e AST canônica do modelo `EDITAL_PREGAO_ELETRONICO_BLL`, compilados de forma **determinística** a partir
do Markdown congelado (`modelo-mestre-edital-pregao-eletronico-bll-v1.0.1-draft.md`, sha256
`6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904`).

> Isto **não** cadastra o modelo, não cria binding, não publica e não ativa flag. É dado versionado + prova de paridade.
> O arquivo-mestre (e o DOCX/relatório congelados) **não** estão neste repositório e não foram alterados.

| Arquivo | O que é |
|---|---|
| `mapping.json` | Mapeamento governado `tpl-master-mapping/2`: dialeto do Markdown, 160 entradas, 48 condições, 13 grupos, âncoras, 58 remissões, 5 anexos, guard, achado de linhagem |
| `catalog.v2.json` | Catálogo `tpl-catalog/2` (185 variáveis: 150 de texto + 3 controles do mestre + 32 decisões de composição) |
| `ast.json` | AST `tpl-ast/2` canônica (saída do compilador) |
| `report.json` · `provenance.json` | Relatório de paridade estrutural, hash semântico da AST e proveniência (sha256 do MD, do mapeamento e do catálogo) |

Reprodução: `pnpm templates:compile-master --md <master.md> --sha256 6795b2ab…7904 --mapping mapping.json --catalog catalog.v2.json --out <dir>`
e, para a prova completa (determinismo, numeração, notas), `BLL_MASTER_MD_PATH=<master.md> pnpm vitest run server/__tests__/unit/institutional-templates-bll-master-source.test.ts`.

## Como foi derivado
* **Entradas (160 = 157 renderizáveis + 3 controles)**: nomes do próprio MD; tipo/fonte/obrigatoriedade/bloco condicional/papel da IA vêm do
  *mapa de campos* derivado na Lane B a partir do relatório de controle **1.0.0-draft** (sha256 `efe20d2a…17a7`), único disponível naquele ambiente.
  **Correção de proveniência:** o pacote juridicamente aprovado é o **v1.0.1** — MD `6795b2ab…7904` (autoridade de conteúdo), DOCX `5927f257…38fa9`,
  relatório de controle MD `a3601b21…7cd0` e DOCX `999422ab…2ca9` (evidência de apoio, não é modelo de runtime). O hash do manifesto do pacote
  **não foi fornecido** e não foi inventado (`manifestSha256: null` em `approvedPackage.json`). Os 160 nomes do MD coincidem com os do 1.0.0,
  exceto `ID_BLL` (removido na 1.0.1, confirmado).
* **Controles** (`renderable=false`): `UTILIZA_SRP`, `ORCAMENTO_SIGILOSO_SIM_NAO`, `DATA_DIVULGACAO_PREVISTA` — só aparecem em NOTAS no mestre;
  entram na AST como `controlRef` (validação) e em condições; nunca em texto.
* **Campos "Propõe" → `aiSlot`** (6): justificativa do art. 49 da LC 123, vedação de consórcio, vedação de subcontratação, obrigações específicas
  (contratado/contratante), finalidades do tratamento de dados. Só com revisão/aceite humano; não são variáveis do catálogo.
* **48 tipos de bloco condicional (80 blocos)**: 8 derivam de campos do mestre (critério, modo de disputa, sigilo, SRP); os outros 40 são
  decisões de composição (`decisao.*`, 32 variáveis `renderable=false`, fonte conforme a coluna "Ativação" do relatório). Pares excludentes → `choice`.
* **Numeração**: a numeração literal do mestre NÃO é copiada — é recalculada (itens `N.M.`, sub-itens, alíneas `a)`/`b.1)`, `CLÁUSULA ORDINAL`,
  sequência simples). Remissões ("item 15.4", "Seção 30", "alínea "b" do item 6.3", "Anexo IV", "Cláusula Primeira") viram `xref` por âncora.
  A fidelidade foi auditada: com os mesmos blocos ativos, 100% dos rótulos automáticos = literal do mestre.

## Decisões desta derivação que pedem CONFIRMAÇÃO HUMANA (nada disso é conteúdo jurídico do mestre)
1. Os 32 `decisao.*` (nomes, fontes e valores) são o contrato de ativação dos blocos; o relatório só diz "quem ativa".
2. Literais de enum que o mestre só descreve: 4º valor de `REGIME_PARTICIPACAO` ("Combinação por item, conforme o quadro de itens"),
   `TIPO_EXIGENCIA_CAPITAL_PL` ("capital social" | "patrimônio líquido"); `CRITERIO_JULGAMENTO`/`MODO_DISPUTA` seguem o texto do mestre em minúsculas.
3. Esquemas de colunas das tabelas (itens da contratação, itens contratados, preços registrados, cadastro de reserva, multas) a partir das notas do mestre.
4. Campos pós-homologação ausentes renderizam `a preencher` (nota do mestre: "campos em branco indicados"); nunca dado fictício.
5. Estrutura do arquivo-mestre excluída do texto oficial: título "MODELO-MESTRE INSTITUCIONAL…", "PARTE 1/2" e separadores `---` (contabilizados).
6. Anexo II: os títulos em negrito "**1. …**" viram seções numeradas (título em negrito).
7. Regra de nota promovida a mapeamento governado (`guards`): alínea "f" do item 17.2 só existe se `AUTORIZACAO_ATIVIDADE_EXIGIDA` vier preenchida.
8. `SE_CONTRATO_POR_ESCOPO` × `SE_SERVICO_OU_FORNECIMENTO_CONTINUO` = `at-most-one` ("conforme TR"); os demais pares = `exactly-one`.
9. Durações saem como "N dias/horas/minutos" (sem o "(extenso)" que o mestre usa nos prazos fixos); `LISTA_ANEXOS_ADICIONAIS` sai como texto de lista —
   os anexos adicionais em si dependem do Document Engine.

## O que as NOTAS dizem e NÃO é executado (por desenho: nota = documentação)
Validações de sistema (ex.: "maior desconto + orçamento sigiloso deve ser recusado", limites de percentual, prazos mínimos do art. 55, canal único sem "ou"),
supressão de campo vazio (obrigações específicas → o `aiSlot` fica *pendente* com marca explícita), texto fixo de "sem qualificação técnica"
e checagem de divergência Edital×TR×Minuta. Cada uma precisa de regra governada própria (follow-up); nenhuma é lida da nota.

## Achado de fidelidade do DOCX (linhagem)
O DOCX congelado (sha256 `5927f257…38fa9`) tem o Anexo II (bloco `SE_MENOR_PRECO`) quebrado: o par de "$" em "Preço unitário (R$)" / "Preço total (R$)" foi
lido como matemática em linha (1 objeto OMML), sumiram os "$" e espaços ("Preçototal(R)") e a tabela virou texto com barras. O MD aprovado está íntegro.
A AST declara "(R$)" nas colunas monetárias e o renderer do Document Engine gera tabela real (teste prova `<w:tbl>`, "(R$)" e valores "R$").
