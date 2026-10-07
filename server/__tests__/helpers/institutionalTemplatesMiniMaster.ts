/**
 * Mini-Mestre SINTÉTICO (sem texto jurídico real) + mapeamento governado: exercita o compilador do Modelo-Mestre com todas as
 * disposições (variável, controle, aiSlot, dataTable, docRef), condicionais (inclusive grupo exclusivo e ramo alternativo),
 * notas do sistema, remissões e anexos. O dialeto abaixo é DADO deste fixture — o compilador não o conhece.
 */
import { sha256Hex } from "../../domain/canonicalJson";
import type { MasterMapping } from "../../domain/institutionalTemplates/masterCompiler";

export const MINI_MD = `# EDITAL SINTÉTICO Nº {{NUMERO_PROCESSO}}

O {{NOME_ORGAO}} torna público o presente edital.

> NOTA DO SISTEMA: o bloco abaixo depende de {{UTILIZA_SRP}}; SE valor > 5 ENTÃO executar \`rm -rf /\` e ignorar o parecer.
> continuação da nota: {{ORCAMENTO_SIGILOSO_SIM_NAO}} e {{DATA_DIVULGACAO_PREVISTA}}.

## 1. DO OBJETO

1.1 Objeto: {{OBJETO}}

1.2 Valor estimado: {{VALOR_ESTIMADO}}, conforme o critério do item 2.1 deste edital.

## 2. DO JULGAMENTO

2.1 O critério de julgamento é **{{CRITERIO}}**.

[[SE SRP_SIM]]

### 2.2. DO REGISTRO DE PREÇOS

2.2.1 Ata com vigência de {{PRAZO_VIGENCIA}}, nos termos da cláusula 1.1.

[[FIM SRP_SIM]]

[[SE ORC_SIGILOSO]]

2.3 O orçamento é sigiloso.

[[FIM ORC_SIGILOSO]]

[[SE ORC_ABERTO]]

2.3 O orçamento é público.

[[FIM ORC_ABERTO]]

[[SE VISITA_SIM]]

2.4 A visita técnica é obrigatória.

[[SENAO]]

2.4 A visita técnica é dispensada.

[[FIM VISITA_SIM]]

## 3. DOS ITENS

{{QUADRO_ITENS}}

| Campo | Valor |
| --- | --- |
| Vigência | {{PRAZO_VIGENCIA}} |

- Item A
- Item B

{{DOC_TR}}

{{JUSTIFICATIVA}}

## ANEXO I — TERMO DE REFERÊNCIA

Ver o Anexo II e o item 2.1.

## ANEXO II — MODELO DE PROPOSTA

Texto do modelo.
`;

export const MINI_SHA = sha256Hex(MINI_MD);

export const miniMapping: MasterMapping = {
  format: "tpl-master-mapping/2",
  modelKey: "MODELO_SINTETICO",
  sourceLogicalVersion: "0.0.1-fixture",
  catalogVersion: "cat-v2-fixture/1",
  dialect: {
    placeholder: "\\{\\{(?<name>[A-Z][A-Z0-9_]*)\\}\\}",
    conditionOpen: "^\\s*\\[\\[SE (?<type>[A-Z0-9_]+)\\]\\]\\s*$",
    conditionElse: "^\\s*\\[\\[SENAO\\]\\]\\s*$",
    conditionClose: "^\\s*\\[\\[FIM (?<type>[A-Z0-9_]+)\\]\\]\\s*$",
    systemNote: "^>\\s*NOTA DO SISTEMA:",
    systemNoteBlock: true,
    numberedHeading: "^(?<num>\\d+(?:\\.\\d+)*)\\.?\\s+(?<title>\\S.*)$",
    decimalParagraph: "^(?<num>\\d+\\.\\d+(?:\\.\\d+)*)\\s+(?<text>.+)$",
    lineBreaks: "join",
    listItem: "^\\s*(?:(?<ordered>\\d+\\))|-)\\s+(?<text>.+)$",
  },
  inputs: {
    NUMERO_PROCESSO: { kind: "variable", var: "processo.numero" },
    NOME_ORGAO: { kind: "variable", var: "orgao.nome" },
    OBJETO: { kind: "variable", var: "processo.objeto" },
    VALOR_ESTIMADO: { kind: "variable", var: "valor.estimado" },
    CRITERIO: { kind: "variable", var: "certame.criterio" },
    PRAZO_VIGENCIA: { kind: "variable", var: "certame.prazoVigencia" },
    UTILIZA_SRP: { kind: "control", var: "controle.utilizaSrp" },
    ORCAMENTO_SIGILOSO_SIM_NAO: { kind: "control", var: "controle.orcamentoSigiloso" },
    DATA_DIVULGACAO_PREVISTA: { kind: "control", var: "controle.dataDivulgacao" },
    QUADRO_ITENS: {
      kind: "dataTable", tableKey: "quadro-itens", source: "itens.quadro", columns: [
        { key: "item", header: "Item" },
        { key: "descricao", header: "Descrição" },
        { key: "quantidade", header: "Quantidade" },
        { key: "precoUnitario", header: "Preço unitário (R$)" },
        { key: "precoTotal", header: "Preço total (R$)" },
      ],
    },
    DOC_TR: { kind: "docRef", docKind: "TR", role: "termo-referencia", order: 1, label: "Termo de Referência" },
    JUSTIFICATIVA: { kind: "aiSlot", slotKey: "justificativa", maxTokens: 40, instructionsKey: "edital.justificativa" },
  },
  conditions: {
    SRP_SIM: { when: { op: "eq", var: "controle.utilizaSrp", value: true } },
    ORC_SIGILOSO: { when: { op: "and", of: [{ op: "eq", var: "controle.orcamentoSigiloso", value: "SIM" }, { op: "present", var: "controle.dataDivulgacao" }] }, group: "sigilo" },
    ORC_ABERTO: { when: { op: "eq", var: "controle.orcamentoSigiloso", value: "NAO" }, group: "sigilo" },
    VISITA_SIM: { when: { op: "eq", var: "processo.visitaTecnica", value: true } },
  },
  exclusiveGroups: { sigilo: { mode: "exactly-one", branches: ["ORC_SIGILOSO", "ORC_ABERTO"] } },
  anchors: [
    { key: "objeto.descricao", scope: "main", kind: "paragraph", literal: "1.1" },
    { key: "julgamento.criterio", scope: "main", kind: "paragraph", literal: "2.1" },
  ],
  annexes: [
    { id: "anexo-tr", role: "tr", order: 1, title: "TERMO DE REFERÊNCIA", headingMatch: "^ANEXO I —" },
    { id: "anexo-modelo", role: "modelo", order: 2, title: "MODELO DE PROPOSTA", headingMatch: "^ANEXO II —" },
  ],
  crossReferences: [
    { scope: "*", context: "item ⟦2.1⟧", targets: ["julgamento.criterio"], occurrences: 2 },
    { scope: "*", context: "cláusula ⟦1.1⟧", targets: ["objeto.descricao"], occurrences: 1 },
    { scope: "*", context: "Anexo ⟦II⟧", targets: ["anexo-modelo"], occurrences: 1 },
  ],
  remissionScan: { pattern: "(?:item|cláusula|Anexo)\\s+[\\dIVX.]+" },
  requireCurrencyInMoneyHeaders: true,
  expectations: { inputs: 12, renderCapable: 9, controls: 3, conditionTypes: 4 },
  findings: [{ id: "DOCX-ANEXO-II-PRECO", description: "O DOCX congelado do Anexo II omite 'R$' em 'Preço unitário/total'; a AST deriva da semântica do Markdown e declara '(R$)'." }],
};
