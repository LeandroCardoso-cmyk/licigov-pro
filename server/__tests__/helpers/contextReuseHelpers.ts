/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Helpers dos testes MySQL do CONTEXT_REUSE 2.0: fazem o que a TELA faz — configurar o Perfil de Licitações UMA vez (políticas pelo
 * mesmo plano de salvar da preparação + papéis) e confirmar os Parâmetros estruturados do TR — SEMPRE pelas rotas existentes.
 * Dados SINTÉTICOS (nenhum dado real).
 */
import { expect } from "vitest";
import type mysql from "mysql2/promise";
import { getTemplateCompositionPorts } from "../../services/institutionalTemplates/portsRegistry";
import { renderTrStructuredBlock } from "../../services/institutionalTemplates/trStructuredParamsService";
import { buildSavePlan, executeSavePlan, isStaleSave, toFormValue, type PlannedWrite, type PreparationStateView, type SectionEdits } from "../../../client/src/lib/editalPreparation";
import type { RoleAssignments } from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import { BLL_CATALOG, E2E_SCENARIO, decision } from "./institutionalTemplatesE2eWorld";
import { sampleValue } from "./institutionalTemplatesBllHarness";

export const SYNTHETIC_ROLES: RoleAssignments = {
  CHEFE_DO_EXECUTIVO: { name: "Prefeito Sintético da Silva", cargo: "Prefeito Municipal", ato: "Diplomação sintética 2024", dataReferencia: "2025-01-01" },
  AUTORIDADE_COMPETENTE: { name: "Autoridade Sintética Souza", cargo: "Secretário Municipal de Administração", ato: "Decreto sintético nº 1/2025", dataReferencia: "2025-01-02" },
  AGENTE_DE_CONTRATACAO: { name: "Agente Sintético Lima", cargo: "Agente de Contratação", ato: "Portaria sintética nº 2/2025", dataReferencia: "2025-01-03" },
  PREGOEIRO: { name: "Pregoeiro Sintético Costa", cargo: "Pregoeiro", ato: "Portaria sintética nº 3/2025", dataReferencia: "2025-01-04" },
  EQUIPE_DE_APOIO: { name: "Ana Sintética; Bruno Sintético; Carla Sintética", ato: "Portaria sintética nº 4/2025" },
  AUTORIDADE_SANCIONADORA: { name: "Autoridade Sancionadora Sintética", cargo: "Secretário Municipal de Administração", ato: "Decreto sintético nº 5/2025" },
  DIRETOR_LICITACOES: { name: "Diretora Sintética Alves", cargo: "Diretora de Licitações" },
  ASSINANTE_DO_EDITAL: { name: "Assinante Sintético Rocha", cargo: "Secretário Municipal de Administração", ato: "Delegação sintética nº 6/2025" },
};

export interface ReuseHarness {
  readonly org: number;
  /** callers (rotas existentes) */
  proc(): any;
  tpl(): any;
  readonly ws: { modality: string; form: string; platform: string };
  readonly processId: string;
  key(prefix: string): string;
}

/** Valor sintético para uma variável do catálogo: cenário do E2E quando houver; senão amostra por tipo. */
export function scenarioValueByName(name: string): unknown {
  if (Object.prototype.hasOwnProperty.call(E2E_SCENARIO, name)) return (E2E_SCENARIO as Record<string, unknown>)[name];
  const def = BLL_CATALOG.vars.find((v) => v.name === name);
  if (!def) throw new Error(`variável desconhecida: ${name}`);
  return sampleValue(def);
}

const stale = (e: unknown) => isStaleSave((e as any)?.data?.code, e instanceof Error ? e.message : String(e));

/** O estado do Perfil na forma que `buildSavePlan` consome (sem processo). */
export function profileAsPrepView(st: any): PreparationStateView {
  return {
    status: "READY_FOR_PREPARATION", revisionId: "profile", catalogVersion: st.catalogVersion,
    revisions: { process: 0, organization: st.revision, budget: 0 }, budgetDisclosure: null, participation: null, participationPending: false,
    trPin: { state: "NOT_SELECTED" }, sections: st.sections, facts: {}, canonicalFields: [], orgProfile: null,
    summary: { groups: [], reusedAutomatically: 0, pendingDecisions: 0 }, metrics: {} as any,
  } as PreparationStateView;
}

/** Configura o Perfil de Licitações do órgão UMA vez: políticas pendentes (plano de salvar da tela) + todos os papéis sintéticos. */
export async function completeProfile(h: ReuseHarness, opts: { roles?: RoleAssignments; defaults?: Record<string, unknown> } = {}): Promise<{ policiesTyped: number; rolesRegistered: number }> {
  let policiesTyped = 0;
  for (let round = 0; round < 4; round++) {
    const st = await h.proc().licitacoesProfile({ processId: h.processId, ...h.ws });
    expect(st.status).toBe("READY");
    const edits: Record<string, Record<string, any>> = {};
    for (const sec of st.sections) {
      for (const f of sec.fields) {
        if (f.status !== "PENDING") continue;
        (edits[sec.source] ??= {})[f.path] = toFormValue(f, scenarioValueByName(f.name)) as any;
        policiesTyped++;
      }
    }
    if (Object.keys(edits).length === 0) break;
    const view = profileAsPrepView(st);
    const plan = buildSavePlan(view, { edits: edits as Record<string, SectionEdits>, disclosure: "", participationDefault: null });
    expect(plan.errors).toEqual({});
    const out = await executeSavePlan(plan.writes, view.revisions, {
      async write(w: PlannedWrite, expectedRevision: number) {
        const r = await h.tpl().governed.recordOrganizationFields({
          confirm: true, idempotencyKey: h.key(w.id), decision: decision(), expectedRevision, catalogVersion: st.catalogVersion, source: w.source as any, fields: w.fields ?? {},
        });
        return { revision: r.decision.revision as number };
      },
    }, stale);
    expect(out.failed, JSON.stringify(out.failed)).toBeNull();
  }
  const st = await h.proc().licitacoesProfile({ processId: h.processId, ...h.ws });
  const roles = opts.roles ?? SYNTHETIC_ROLES;
  const defaults = opts.defaults;
  await h.tpl().governed.recordLicitacoesProfile({
    confirm: true, idempotencyKey: h.key("profile"), decision: decision(), expectedRevision: st.revision, catalogVersion: st.catalogVersion,
    roles, ...(defaults ? { defaults } : {}),
  });
  return { policiesTyped, rolesRegistered: Object.keys(roles).length };
}

/** Confirma os Parâmetros estruturados do TR pendentes (rota existente), repetindo até estabilizar (condicionais ativam em cascata). */
export async function fillTrParams(h: ReuseHarness, override: Record<string, unknown> = {}, skip: readonly string[] = []): Promise<{ typed: string[] }> {
  const typed: string[] = [];
  for (let round = 0; round < 6; round++) {
    const st = await h.proc().trStructuredParams({ processId: h.processId, ...h.ws });
    expect(st.status).toBe("READY");
    const pend = (st.fields as any[]).filter((f) => f.active && (f.required || f.conditional) && f.status !== "SET" && !skip.includes(f.name));
    if (pend.length === 0) return { typed };
    const values: Record<string, unknown> = {};
    for (const f of pend) { values[f.name] = Object.prototype.hasOwnProperty.call(override, f.name) ? override[f.name] : scenarioValueByName(f.name); typed.push(f.name); }
    await h.proc().recordTrStructuredParams({ processId: h.processId, ...h.ws, values });
  }
  throw new Error("parâmetros do TR não convergiram");
}

/**
 * Simula a EMISSÃO do TR com o snapshot atual dos parâmetros estruturados: grava no metadata do documento oficial o digest que o
 * marcador `trparams:` do rascunho carregaria (a promoção real faz o mesmo). Metadata não entra no hash do conteúdo (o pin não muda).
 * Sem parâmetros confirmados não há snapshot (TR legado/sem estrutura).
 */
export async function stampTrLineage(conn: mysql.Connection, h: ReuseHarness, documentId: string): Promise<string | null> {
  const deps = { ports: getTemplateCompositionPorts(), now: () => new Date().toISOString() };
  const block = await renderTrStructuredBlock(deps, h.org, h.processId, h.ws as never);
  if (!block) return null;
  const digest = block.digest;   // SHA-256 COMPLETO (64 hex)
  const [rows] = await conn.execute("SELECT metadata FROM official_documents WHERE id = ? AND tenant_id = ?", [documentId, h.org]);
  const current = (rows as Array<{ metadata: string | null }>)[0]?.metadata;
  const meta = current ? (typeof current === "string" ? JSON.parse(current) : current) : {};
  await conn.execute("UPDATE official_documents SET metadata = ? WHERE id = ? AND tenant_id = ?", [JSON.stringify({ ...meta, structuredParamsDigest: digest }), documentId, h.org]);
  return digest;
}
