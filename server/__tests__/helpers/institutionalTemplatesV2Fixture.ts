/**
 * Institutional Templates — fixture SINTÉTICA para `tpl-ast/2` + `tpl-catalog/2` (sem texto jurídico real, sem DB).
 * Genérica de propósito: nada aqui é específico de modalidade, plataforma ou modelo.
 */
import {
  createDraftRevision, transitionRevision,
  type TemplateAST2, type TemplateIdentity, type TemplateRevision, type VariableCatalog2,
} from "../../domain/institutionalTemplates";
import type { CanonicalSourceSnapshot, OfficialDocumentPin, TemplateComposeRequest } from "../../domain/institutionalTemplates/composer";
import type { DocRefKind2 } from "../../domain/institutionalTemplates/ast2";
import type { VariableSource2 } from "../../domain/institutionalTemplates/variableCatalog2";

export const ORG_A = 972001;
export const ORG_B = 972002;
export const H = (c: string): string => c.repeat(64).slice(0, 64);

/** Os 17 tipos do catálogo v2 e as 13 fontes aparecem pelo menos uma vez. */
export const catalog2: VariableCatalog2 = {
  format: "tpl-catalog/2",
  version: "cat-v2-fixture/1",
  vars: [
    { name: "orgao.nome", type: "string", source: "IDENTITY", path: "organizationName", required: true, renderable: true },
    { name: "orgao.cnpj", type: "cnpj", source: "IDENTITY", path: "cnpj", required: false, renderable: true },
    { name: "processo.numero", type: "string", source: "PROCESS", path: "number", required: true, renderable: true },
    { name: "processo.objeto", type: "text", source: "PROCESS", path: "object", required: true, renderable: true },
    { name: "processo.visitaTecnica", type: "boolean", source: "PROCESS", path: "technicalVisit", required: false, renderable: true },
    { name: "processo.numeroLotes", type: "integer", source: "ITEMS", path: "lotCount", required: false, renderable: true },
    { name: "processo.fator", type: "number", source: "PARAMS", path: "factor", required: false, renderable: true },
    { name: "processo.portal", type: "url", source: "PARAMS", path: "portalUrl", required: false, renderable: true },
    { name: "processo.horarioSessao", type: "time", source: "PARAMS", path: "sessionTime", required: false, renderable: true },
    { name: "certame.dataAbertura", type: "datetime", source: "CERTAME_CONFIG", path: "openingAt", required: false, renderable: true },
    { name: "certame.prazoVigencia", type: "duration", source: "CERTAME_CONFIG", path: "term", required: false, renderable: true },
    { name: "certame.criterio", type: "enum", source: "CERTAME_CONFIG", path: "criterion", required: true, renderable: true, enumValues: ["menor_preco", "maior_desconto"] },
    { name: "certame.valorLimite", type: "money", source: "BUDGET", path: "ceilingCents", required: false, renderable: true },
    { name: "valor.estimado", type: "money", source: "BUDGET", path: "estimatedTotalCents", required: false, renderable: true },
    { name: "valor.margem", type: "percent", source: "POLICY", path: "preferenceMargin", required: false, renderable: true },
    {
      name: "itens.quadro", type: "table", source: "ITEMS", path: "rows", required: true, renderable: true,
      columns: [
        { key: "item", type: "integer", label: "Nº do item" },
        { key: "descricao", type: "string", label: "Descrição" },
        { key: "quantidade", type: "number", label: "Quantidade" },
        { key: "precoUnitario", type: "money", label: "Preço unitário" },
        { key: "precoTotal", type: "money", label: "Preço total", required: false },
      ],
    },
    { name: "etp.lotes", type: "list", source: "ETP", path: "lots", required: false, renderable: true, itemType: "string" },
    { name: "tr.referencia", type: "document_ref", source: "TR", path: "ref", required: false, renderable: true, documentKind: "TR" },
    { name: "normativo.fundamento", type: "text", source: "NORMATIVE", path: "legalBasis", required: false, renderable: true },
    { name: "resultado.vencedor", type: "string", source: "RESULT", path: "winner", required: false, renderable: true },
    { name: "ciclo.situacao", type: "enum", source: "LIFECYCLE", path: "status", required: false, renderable: true, enumValues: ["aberto", "encerrado"] },
    { name: "dfd.justificativa", type: "text", source: "DFD", path: "justification", required: false, renderable: true },
    // Controles: participam de condição/validação/decisão, NUNCA de texto.
    { name: "controle.utilizaSrp", type: "boolean", source: "CERTAME_CONFIG", path: "usesSrp", required: true, renderable: false },
    { name: "controle.orcamentoSigiloso", type: "enum", source: "POLICY", path: "secretBudget", required: true, renderable: false, enumValues: ["SIM", "NAO"] },
    {
      name: "controle.dataDivulgacao", type: "date", source: "BUDGET", path: "disclosureDate", required: false, renderable: false,
      requiredWhen: { op: "eq", var: "controle.orcamentoSigiloso", value: "SIM" },
    },
  ],
};

const t = (v: string) => ({ t: "text", v }) as const;
const v = (name: string) => ({ t: "var", name }) as const;

export const ast2: TemplateAST2 = {
  schema: "tpl-ast/2",
  root: [
    { t: "heading", level: 1, text: [t("Aviso nº "), v("processo.numero")] },
    { t: "paragraph", inline: [t("Órgão: "), v("orgao.nome"), t(", CNPJ "), v("orgao.cnpj")] },
    {
      t: "section", key: "objeto", numbering: "auto", title: [t("DO OBJETO")], children: [
        { t: "paragraph", numbered: true, anchor: "objeto.descricao", inline: [v("processo.objeto")] },
        { t: "paragraph", numbered: true, inline: [t("Valor estimado: "), v("valor.estimado"), t(" (margem de preferência "), v("valor.margem"), t(").")] },
      ],
    },
    {
      t: "section", key: "julgamento", numbering: "auto", title: [t("DO JULGAMENTO")], children: [
        { t: "paragraph", numbered: true, anchor: "julgamento.criterio", inline: [t("Critério de julgamento: "), v("certame.criterio"), t(".")] },
        {
          t: "conditional", when: { op: "eq", var: "controle.utilizaSrp", value: true }, then: [
            {
              t: "section", key: "srp", numbering: "auto", title: [t("DO REGISTRO DE PREÇOS")], children: [
                { t: "paragraph", numbered: true, anchor: "srp.clausula", inline: [t("Ata de registro de preços com vigência de "), v("certame.prazoVigencia"), t(".")] },
              ],
            },
          ],
        },
        {
          t: "choice", groupKey: "sigilo", mode: "exactly-one", branches: [
            { key: "sigiloso", when: { op: "and", of: [{ op: "eq", var: "controle.orcamentoSigiloso", value: "SIM" }, { op: "present", var: "controle.dataDivulgacao" }] }, children: [
              { t: "paragraph", numbered: true, anchor: "orcamento.sigiloso", inline: [t("O orçamento estimado é sigiloso.")] },
            ] },
            { key: "aberto", when: { op: "eq", var: "controle.orcamentoSigiloso", value: "NAO" }, children: [
              { t: "paragraph", numbered: true, anchor: "orcamento.aberto", inline: [t("O orçamento estimado é público.")] },
            ] },
          ],
        },
      ],
    },
    {
      t: "section", key: "remissoes", numbering: "none", children: [
        { t: "paragraph", inline: [t("Conforme o item "), { t: "xref", target: "julgamento.criterio" }, t(" e a cláusula "), { t: "xref", target: "objeto.descricao" }, t(".")] },
      ],
    },
    {
      t: "dataTable", tableKey: "quadro", source: "itens.quadro", columns: [
        { key: "item", header: [t("Item")] },
        { key: "descricao", header: [t("Descrição")] },
        { key: "quantidade", header: [t("Quantidade")] },
        { key: "precoUnitario", header: [t("Preço unitário (R$)")] },
        { key: "precoTotal", header: [t("Preço total (R$)")] },
      ],
    },
    { t: "table", header: [[t("Campo")], [t("Valor")]], rows: [[[t("Visita técnica")], [v("processo.visitaTecnica")]], [[t("Abertura")], [v("certame.dataAbertura")]]] },
    { t: "list", ordered: true, items: [[{ t: "paragraph", inline: [t("Lotes: "), v("etp.lotes")] }]] },
    { t: "docRef", kind: "TR", mode: "EXACT_PINNED", role: "termo-referencia", order: 1, label: [t("Termo de Referência vigente")] },
    { t: "aiSlot", slotKey: "justificativa", maxTokens: 40, instructionsKey: "aviso.justificativa" },
    // Fora de ordem de propósito: a ordem de renderização é a do `order`, não a da posição no AST.
    { t: "annex", id: "anexo-modelo", role: "modelo", order: 2, title: [t("Modelo de proposta")], children: [{ t: "paragraph", inline: [t("Texto do modelo.")] }] },
    { t: "annex", id: "anexo-tr", role: "tr", order: 1, title: [t("Termo de Referência")], children: [{ t: "docRef", kind: "TR", mode: "EXACT_PINNED", role: "anexo-tr-ref", order: 2 }] },
  ],
};

export const identity2: TemplateIdentity = {
  id: "tplid_v2f", organizationId: ORG_A, documentKind: "edital", slug: "aviso-generico", createdAt: "2026-10-07T00:00:00Z", createdByUserId: 7,
};

export function draftRevision2(over: Partial<{ id: string; ast: TemplateAST2; identity: TemplateIdentity; catalog: VariableCatalog2 }> = {}): TemplateRevision {
  const r = createDraftRevision({
    id: over.id ?? "tplrev_v2f", identity: over.identity ?? identity2, revision: 1, ast: over.ast ?? ast2, catalog: over.catalog ?? catalog2, sourceFormat: "NATIVE",
  });
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.value;
}

export function publishedRevision2(over: Partial<{ id: string; ast: TemplateAST2; identity: TemplateIdentity; catalog: VariableCatalog2 }> = {}): TemplateRevision {
  const id = over.identity ?? identity2;
  const cat = over.catalog ?? catalog2;
  const a = transitionRevision(draftRevision2(over), { to: "APPROVED", approvalDecisionId: "dec_approve_v2" }, id, cat);
  if (!a.ok) throw new Error(JSON.stringify(a.issues));
  const p = transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "dec_publish_v2" }, id, cat);
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.value;
}

export const ROWS = [
  { item: 1, descricao: "Papel A4 | 75g", quantidade: 1200, precoUnitario: 2550, precoTotal: 3060000 },
  { item: 2, descricao: "Caneta esferográfica", quantidade: 500.5, precoUnitario: 150 },
];

export function canonicalSources2(org = ORG_A, over: Partial<Record<VariableSource2, unknown>> = {}): Partial<Record<VariableSource2, CanonicalSourceSnapshot>> {
  const data: Partial<Record<VariableSource2, unknown>> = {
    IDENTITY: { organizationName: "Órgão Sintético", cnpj: "11.222.333/0001-81" },
    PROCESS: { number: "2026/0007", object: "Aquisição sintética\nde material de expediente", technicalVisit: false },
    PARAMS: { factor: 1.5, portalUrl: "https://portal.exemplo.gov.br/compras", sessionTime: "09:30" },
    CERTAME_CONFIG: { usesSrp: true, criterion: "menor_preco", term: { amount: 12, unit: "month" }, openingAt: "2026-11-05T09:30" },
    BUDGET: { estimatedTotalCents: 3060000, ceilingCents: 5000000, disclosureDate: "2026-12-01" },
    POLICY: { secretBudget: "NAO", preferenceMargin: 5.5 },
    ITEMS: { rows: ROWS, lotCount: 3 },
    ETP: { lots: ["Lote 1", "Lote 2"] },
    TR: { ref: { documentId: "odoc_tr_1", lineageId: "odln_tr_1", version: 2, contentHash: H("a"), title: "Termo de Referência" } },
    ...over,
  };
  const out: Partial<Record<VariableSource2, CanonicalSourceSnapshot>> = {};
  for (const [k, val] of Object.entries(data)) out[k as VariableSource2] = { organizationId: org, data: val };
  return out;
}

export function trPin2(org = ORG_A, over: Partial<OfficialDocumentPin> = {}): Partial<Record<DocRefKind2, OfficialDocumentPin>> {
  return { TR: { organizationId: org, documentId: "odoc_tr_1", lineageId: "odln_tr_1", version: 2, contentHash: H("a"), title: "Termo de Referência", ...over } };
}

export function composeRequest2(over: Partial<TemplateComposeRequest> = {}): TemplateComposeRequest {
  const revision = over.revision ?? publishedRevision2();
  return {
    organizationId: ORG_A,
    identity: identity2,
    revision,
    catalog: catalog2,
    pin: { identityId: revision.identityId, revisionId: revision.id, semanticHash: revision.semanticHash },
    sources: canonicalSources2(),
    officialDocuments: trPin2(),
    aiNarratives: [{ organizationId: ORG_A, slotKey: "justificativa", executionId: "aiexec_v2", text: "Justificativa sintética redigida para revisão humana." }],
    identityFingerprint: "fp-identity-v2",
    generatedDocumentId: "gdoc_v2_1",
    createdAt: "2026-10-07T12:00:00.000Z",
    ...over,
  };
}
