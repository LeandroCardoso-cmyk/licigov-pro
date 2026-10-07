/**
 * Harness do modelo EDITAL_PREGAO_ELETRONICO_BLL (dados governados em `server/domain/institutionalTemplates/models/…`):
 * carrega catálogo v2 + mapeamento e fabrica fontes canônicas SINTÉTICAS por cenário (sem dado real, sem DB).
 */
import { readFileSync } from "fs";
import path from "path";
import {
  createDraftRevision, transitionRevision,
  type TemplateAST2, type TemplateIdentity, type TemplateRevision, type VariableCatalog2, type VariableDef2,
} from "../../domain/institutionalTemplates";
import type { CanonicalSourceSnapshot, OfficialDocumentPin, TemplateComposeRequest } from "../../domain/institutionalTemplates/composer";
import type { MasterMapping } from "../../domain/institutionalTemplates/masterCompiler";
import type { VariableSource2 } from "../../domain/institutionalTemplates/variableCatalog2";

export const BLL_MD_SHA256 = "6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904";
export const BLL_MODEL_DIR = path.resolve(__dirname, "../../domain/institutionalTemplates/models/edital-pregao-eletronico-bll");
export const BLL_ORG = 975001;

export const bllCatalog = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "catalog.v2.json"), "utf8")) as VariableCatalog2;
export const bllMapping = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "mapping.json"), "utf8")) as MasterMapping;

export const bllIdentity: TemplateIdentity = {
  id: "tplid_bll", organizationId: BLL_ORG, documentKind: "edital", slug: "edital-pregao-eletronico-bll", createdAt: "2026-10-07T00:00:00Z", createdByUserId: 7,
};

/** Valor SINTÉTICO determinístico por tipo (nunca dado real). */
export function sampleValue(def: VariableDef2): unknown {
  const label = def.name;
  switch (def.type) {
    case "string": case "text": return `Texto sintético de ${label}`;
    case "integer": return 7;
    case "number": return 10;
    case "boolean": return false;
    case "money": return 123456;
    case "percent": return 5;
    case "date": return "2026-11-05";
    case "time": return "09:30";
    case "datetime": return "2026-11-05T09:30";
    case "duration": return { amount: 3, unit: "day" };
    case "enum": return (def.enumValues ?? [])[0];
    case "list": return ["Item sintético A", "Item sintético B"];
    case "url": return "https://exemplo.gov.br/sintetico";
    case "cnpj": return "11222333000181";
    case "document_ref": return { documentId: "odoc_tr_bll", lineageId: "odln_tr_bll", version: 2, contentHash: "a".repeat(64), title: "Termo de Referência" };
    case "table": return [1, 2].map((n) => Object.fromEntries((def.columns ?? []).map((c) => [c.key, ((): unknown => {
      switch (c.type) {
        case "string": case "text": return `${c.label ?? c.key} ${n}`;
        case "integer": return n;
        case "number": return 10 * n;
        case "money": return 2550 * n;
        case "percent": return 1.5 * n;
        case "cnpj": return "11222333000181";
        default: return `${c.key}${n}`;
      }
    })()])));
  }
}

function setPath(root: Record<string, unknown>, p: string, value: unknown): void {
  const segs = p.split(".");
  let cur = root;
  segs.slice(0, -1).forEach((seg) => { cur[seg] = (cur[seg] as Record<string, unknown> | undefined) ?? {}; cur = cur[seg] as Record<string, unknown>; });
  cur[segs[segs.length - 1]] = value;
}

export type Scenario = Readonly<Record<string, unknown>>;

/** Padrão do mestre: SEM SRP, orçamento público, menor preço, disputa aberta, por item, sem blocos opcionais. */
export const BASE_SCENARIO: Scenario = {
  "julgamento.valorEstimado": 987654, // R$ 9.876,54 — distinto de qualquer outro valor monetário de amostra (teste de sigilo)
  "controle.utilizaSrp": false,
  "controle.orcamentoSigilosoSimNao": false,
  "julgamento.criterioJulgamento": "menor preço",
  "julgamento.modoDisputa": "aberto",
  "decisao.formaJulgamento": "item",
  "decisao.consorcio": "admite",
  "decisao.inversaoFases": false,
  "decisao.instrumentoContratual": "termo",
  "decisao.subcontratacao": "veda",
  "decisao.tratamentoDadosPessoais": false,
};

/** Todos os blocos opcionais LIGADOS (cenário de auditoria de numeração). */
export const FULL_SCENARIO: Scenario = {
  ...BASE_SCENARIO,
  "controle.utilizaSrp": true,
  "decisao.formaJulgamento": "lote",
  "decisao.regulamentoMunicipalVerificado": true,
  "decisao.pastaTecnica": true,
  "decisao.adesaoAta": "veda",
  "decisao.participacaoCooperativa": true,
  "decisao.exclusivoMeEpp": true,
  "decisao.cotaReservada": true,
  "decisao.beneficioAfastado": true,
  "decisao.tratamentoRegional": true,
  "decisao.modalidadeTratamentoRegional": "prioridade",
  "decisao.exigeMarcaModelo": true,
  "decisao.propostaSemIdentificacao": true,
  "decisao.intervaloMinimoLances": true,
  "decisao.exigeCatalogo": true,
  "decisao.exigeAmostra": true,
  "decisao.exigeProvaConceito": true,
  "decisao.aceitaRegistroCadastral": true,
  "decisao.exigeBalanco": true,
  "decisao.exigeCapitalOuPlMinimo": true,
  "decisao.visitaTecnicaFacultativa": true,
  "decisao.declaracaoEspecificaObjeto": true,
  "decisao.subcontratacao": "admite",
  "decisao.repactuacao": true,
  "decisao.exigeGarantiaContratual": true,
  "decisao.contratoPorEscopo": true,
  "decisao.matrizDeRiscos": true,
  "decisao.tratamentoDadosPessoais": true,
  "decisao.anexosAdicionais": true,
};

/** Fontes canônicas sintéticas (todas as variáveis do catálogo com valor de amostra; `overrides` por nome de variável). */
export function bllSources(overrides: Scenario = {}, org = BLL_ORG, omit: readonly string[] = []): Partial<Record<VariableSource2, CanonicalSourceSnapshot>> {
  const known = new Set(bllCatalog.vars.map((v) => v.name));
  for (const k of [...Object.keys(overrides), ...omit]) if (!known.has(k)) throw new Error(`cenário/omissão com variável fora do catálogo: ${k}`);
  const data: Partial<Record<VariableSource2, Record<string, unknown>>> = {};
  for (const def of bllCatalog.vars) {
    if (omit.includes(def.name)) continue;
    const value = Object.prototype.hasOwnProperty.call(overrides, def.name) ? overrides[def.name] : sampleValue(def);
    if (value === undefined) continue;
    setPath((data[def.source] ??= {}), def.path, value);
  }
  const out: Partial<Record<VariableSource2, CanonicalSourceSnapshot>> = {};
  for (const [k, v] of Object.entries(data)) out[k as VariableSource2] = { organizationId: org, data: v };
  return out;
}

export function bllRevision(ast: TemplateAST2, id = "tplrev_bll"): TemplateRevision {
  const d = createDraftRevision({ id, identity: bllIdentity, revision: 1, ast, catalog: bllCatalog, sourceFormat: "NATIVE" });
  if (!d.ok) throw new Error(`rascunho BLL inválido: ${JSON.stringify(d.issues).slice(0, 600)}`);
  const a = transitionRevision(d.value, { to: "APPROVED", approvalDecisionId: "dec_a" }, bllIdentity, bllCatalog);
  if (!a.ok) throw new Error(JSON.stringify(a.issues));
  const p = transitionRevision(a.value, { to: "PUBLISHED", publishDecisionId: "dec_p" }, bllIdentity, bllCatalog);
  if (!p.ok) throw new Error(JSON.stringify(p.issues));
  return p.value;
}

export const bllTrPin = (org = BLL_ORG): OfficialDocumentPin => ({
  organizationId: org, documentId: "odoc_tr_bll", lineageId: "odln_tr_bll", version: 2, contentHash: "a".repeat(64), title: "Termo de Referência",
});

export function bllComposeRequest(ast: TemplateAST2, scenario: Scenario, over: Partial<TemplateComposeRequest> = {}, omit: readonly string[] = []): TemplateComposeRequest {
  const revision = bllRevision(ast);
  return {
    organizationId: BLL_ORG, identity: bllIdentity, revision, catalog: bllCatalog,
    pin: { identityId: revision.identityId, revisionId: revision.id, semanticHash: revision.semanticHash },
    sources: bllSources(scenario, BLL_ORG, omit), officialDocuments: { TR: bllTrPin() }, aiNarratives: [],
    identityFingerprint: "fp-bll", generatedDocumentId: "gdoc_bll_1", createdAt: "2026-10-07T12:00:00.000Z",
    ...over,
  };
}
