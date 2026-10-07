/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * "Mundo" SINTÉTICO para os smokes MySQL do piloto do Edital (nada real: órgão, processo, itens, TR e narrativas fictícios).
 * Monta, SÓ pelas autoridades reais do sistema: organização + identidade, processo, Itens da contratação CANÔNICOS com preço,
 * decisão de divulgação do orçamento, campos governados por fonte (a partir do catálogo do modelo), TR oficial emitido e
 * execuções de IA auditáveis. Nunca escreve em produção; cada órgão usa um id sintético exclusivo.
 */
import type mysql from "mysql2/promise";
import { createHash } from "node:crypto";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { insertProcess } from "../../db/procurement";
import { listIntelligentItems, transitionItemStatusCAS } from "../../db/procurement";
import { importManualPriceResearch } from "../../services/itemMaterializationService";
import { saveInstitutionalIdentity } from "../../services/institutionalIdentityService";
import { invalidateFlagCache } from "../../services/featureFlagService";
import { GovernedSourceService } from "../../services/institutionalTemplates/governedSourceService";
import { createVariableCatalogPort } from "../../services/institutionalTemplates/catalogRegistry";
import { MODEL_PACKAGES } from "../../services/institutionalTemplates/modelPackages";
import { FF_INSTITUTIONAL_TEMPLATES_V1 } from "../../services/institutionalTemplates/portsRegistry";
import { AUTHORITY_OWNED_PATHS, ORG_SCOPE_SOURCES, PROCESS_SCOPE_SOURCES } from "../../domain/institutionalTemplates/governedSources";
import type { VariableSource2 } from "../../domain/institutionalTemplates/variableCatalog2";
import type { WorkflowContext } from "../../services/institutionalTemplates/ports";
import { confirmCanonicalItemsFromResearch } from "./canonicalItems";
import { BASE_SCENARIO, sampleValue, type Scenario } from "./institutionalTemplatesBllHarness";

export const BLL = MODEL_PACKAGES[0];
export const BLL_CATALOG = BLL.catalog;
export const U_AUTHOR = 101;   // gera o rascunho
export const U_EDITOR = 202;   // edita (último ator substantivo)
export const U_MANAGER = 303;  // aprova / publica / aceita / emite (SoD ≠ autor ≠ editor)

export const decision = (over: Record<string, unknown> = {}) => ({
  decidedByName: "Maria Souza", decidedByRole: "Procuradora-Geral", decidedAt: "2026-10-06",
  basisReference: "Portaria 12/2026", reason: "Conferido pela assessoria jurídica.", ...over,
});
export const ctxOf = (org: number, userId = U_MANAGER, kind: "human" | "ai" = "human"): WorkflowContext =>
  ({ organizationId: org, actor: { kind, userId } as any, correlationId: `corr-${org}-${userId}` });

/** CNPJ sintético VÁLIDO (dígitos verificadores corretos) derivado de uma semente numérica. */
export function syntheticCnpj(seed: number): string {
  const base = String(seed).padStart(8, "0").slice(-8) + "0001";
  const dv = (digits: string, weights: number[]) => { const r = digits.split("").reduce((a, d, i) => a + Number(d) * weights[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = dv(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(base + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base}${d1}${d2}`;
}

export interface World { org: number; processId: string; items: string[] }

/** Cenário-base do mestre ajustado para satisfazer as REGRAS governadas (datas coerentes, acréscimo de consórcio na faixa). */
export const E2E_SCENARIO: Scenario = {
  ...BASE_SCENARIO,
  "controle.dataDivulgacaoPrevista": "2026-10-20",
  "participacao.percentualAcrescimoConsorcio": 15,
};

/** Campos governados de UMA fonte, a partir do catálogo: valor do cenário quando houver; senão amostra sintética por tipo. */
export function governedFieldsFor(source: VariableSource2, scenario: Scenario = E2E_SCENARIO): Record<string, unknown> {
  const owned = new Set(AUTHORITY_OWNED_PATHS[source] ?? []);
  const out: Record<string, unknown> = {};
  for (const def of BLL_CATALOG.vars) {
    if (def.source !== source || owned.has(def.path) || def.type === "document_ref") continue;
    if (def.name.startsWith("pos.")) continue;          // pós-homologação: NUNCA preenchido no pré-certame ("a preencher")
    const value = Object.prototype.hasOwnProperty.call(scenario, def.name) ? scenario[def.name] : sampleValue(def);
    if (value !== undefined) out[def.path] = value;
  }
  return out;
}

export async function setFlag(conn: mysql.Connection, org: number, on: boolean): Promise<void> {
  await conn.execute("INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage) VALUES (?, ?, ?, 100) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), percentage = 100", [org, FF_INSTITUTIONAL_TEMPLATES_V1, on ? 1 : 0]);
  invalidateFlagCache(FF_INSTITUTIONAL_TEMPLATES_V1, org);
}

/** Órgão + identidade institucional + processo (nº AAAA/NNNN) + Itens da contratação canônicos COM preço. */
export async function seedWorld(conn: mysql.Connection, org: number, label: string, opts: { flagOn?: boolean; items?: Array<{ description: string; unit: string; planned: number; price: string }> } = {}): Promise<World> {
  await conn.execute("INSERT INTO organizations (id, nome, slug, ativo, municipio, uf, esfera) VALUES (?, ?, ?, 1, 'Moreira Sales', 'PR', 'municipal') ON DUPLICATE KEY UPDATE nome = VALUES(nome), municipio = 'Moreira Sales', uf = 'PR'",
    [org, `Prefeitura Sintética ${label}`, `e2e-${org}`]);
  await saveInstitutionalIdentity(org, {
    organizationName: `Prefeitura Sintética ${label}`, cnpj: syntheticCnpj(org), address: "Rua Sintética, 100 — Centro", phone: "(44) 0000-0000",
    website: "https://sintetico.exemplo.gov.br",
  });
  await setFlag(conn, org, opts.flagOn ?? true);
  const ws = createProcurementWorkspace({ organizationId: org, processNumber: `2026/${String(org % 10000).padStart(4, "0")}`, object: "Aquisição sintética de material de expediente", modality: "pregao", startOption: "iniciar_pesquisa", responsibleUser: U_AUTHOR, correlationId: `e2e-${label}` });
  await insertProcess(ws);
  const rows = opts.items ?? [
    { description: "Papel sulfite A4 75g", unit: "resma", planned: 120, price: "25,50" },
    { description: "Caneta esferográfica azul", unit: "un", planned: 400, price: "1,75" },
  ];
  const text = rows.flatMap((r) => [`${r.description};${r.planned};${r.unit};R$ ${r.price};Fornecedor A`, `${r.description};${r.planned};${r.unit};R$ ${r.price};Fornecedor B`]).join("\n");
  await importManualPriceResearch({ organizationId: org, processId: ws.id, source: "colar", text, actorUserId: U_AUTHOR, correlationId: `e2e-res-${label}` });
  for (const it of await listIntelligentItems(ws.id, org)) {
    await transitionItemStatusCAS({ id: it.id, orgId: org, fromStatuses: ["pendente", "em_analise"], toStatus: "aprovado", approvedBy: U_MANAGER, updatedAt: new Date().toISOString() });
  }
  await confirmCanonicalItemsFromResearch({
    organizationId: org, processId: ws.id, actorUserId: U_AUTHOR, idempotencyKey: `e2e-items-${org}`,
    planned: Object.fromEntries(rows.map((r) => [r.description, r.planned])),
  });
  return { org, processId: ws.id, items: rows.map((r) => r.description) };
}

/** Registra TODOS os campos governados e a divulgação do orçamento (decisões humanas no ledger existente). */
export async function seedGoverned(w: World, scenario: Scenario = E2E_SCENARIO, disclosure: "publico" | "sigiloso" = "publico", tag = "g"): Promise<void> {
  const gov = new GovernedSourceService(createVariableCatalogPort());
  const ctx = ctxOf(w.org);
  const act = (k: string) => ({ confirm: true, idempotencyKey: `e2e-${tag}-${k}-${w.org}`, decision: decision() });
  const common = { catalogVersion: BLL_CATALOG.version, expectedRevision: 0 } as const;
  await gov.recordBudgetDisclosure(ctx, { ...act("disclosure"), processId: w.processId, disclosure, expectedRevision: 0 });
  // por processo: cada seção grava uma nova revisão do MESMO registro (CAS 0, 1, 2…)
  let rev = 0;
  for (const source of PROCESS_SCOPE_SOURCES) {
    const fields = governedFieldsFor(source, scenario);
    if (Object.keys(fields).length === 0) continue;
    await gov.recordProcessFields(ctx, { ...act(source), ...common, expectedRevision: rev++, processId: w.processId, source, fields,
      ...(source === "ITEMS" ? { participation: { default: "Ampla participação, com os benefícios da LC nº 123/2006" } } : {}) });
  }
  // por órgão: POLICY e IDENTITY (extensão)
  let orev = 0;
  for (const source of ORG_SCOPE_SOURCES) {
    const fields = governedFieldsFor(source, scenario);
    if (Object.keys(fields).length === 0) continue;
    await gov.recordOrganizationFields(ctx, { ...act(`o-${source}`), ...common, expectedRevision: orev++, source, fields });
  }
}

/** TR oficial EMITIDO do processo (linha sintética em `official_documents`) — devolve o pin exato (id + versão + hash do conteúdo). */
export async function seedOfficialTr(conn: mysql.Connection, w: World, version = 1, content = "TERMO DE REFERÊNCIA — conteúdo sintético v1"): Promise<{ documentId: string; version: number; contentHash: string }> {
  const id = createHash("sha256").update(`tr:${w.org}:${w.processId}:${version}`).digest("hex").slice(0, 20);
  await conn.execute(
    `INSERT INTO official_documents (id, tenant_id, business_domain, document_type, origin, title, version, status, content, lineage_id, replay_hash, storage_key, mime_type, size_bytes, content_hash)
     VALUES (?, ?, 'processo_licitatorio', 'tr', ?, 'Termo de Referência', ?, 'emitido', ?, ?, ?, '', '', 0, '')`,
    [id, w.org, w.processId, version, content, `ln${w.org}`.slice(0, 20), `rh-${id}`]);
  return { documentId: id, version, contentHash: createHash("sha256").update(content).digest("hex") };
}

/** Execução de IA auditável com a narrativa de UM slot (o texto nunca vem do cliente). */
export async function seedAiExecution(conn: mysql.Connection, org: number, slotKey: string, text: string): Promise<string> {
  const id = createHash("sha256").update(`ai:${org}:${slotKey}:${text}`).digest("hex").slice(0, 20);
  await conn.execute(
    "INSERT INTO ai_orchestrations (id, organization_id, session_id, replay_key, outputs, started_at, updated_at, created_at) VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE outputs = VALUES(outputs)",
    [id, org, `sess-${org}`, `rk-${id}`, JSON.stringify({ templateNarrative: { slotKey, text } })]);
  return id;
}

/** Limpeza por tenant sintético (best-effort; ordem respeita as FKs compostas). */
export async function cleanupOrgs(conn: mysql.Connection, orgs: number[]): Promise<void> {
  if (orgs.length === 0) return;
  const q = orgs.join(",");
  const stmts = [
    `DELETE FROM document_composition_references WHERE organization_id IN (${q})`,
    `DELETE FROM document_composition_manifests WHERE organization_id IN (${q}) AND derived_from_manifest_id IS NOT NULL`,
    `DELETE FROM document_composition_manifests WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_events WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_bindings WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_revisions WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_identities WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_decisions WHERE organization_id IN (${q})`,
    `DELETE FROM generated_document_edits WHERE organization_id IN (${q})`,
    `DELETE FROM generated_documents WHERE organization_id IN (${q})`,
    `DELETE FROM official_document_artifacts WHERE tenant_id IN (${q})`,
    `DELETE FROM official_documents WHERE tenant_id IN (${q})`,
    `DELETE FROM ai_orchestrations WHERE organization_id IN (${q})`,
    `DELETE FROM tenant_feature_flags WHERE organizationId IN (${q})`,
    `DELETE FROM procurement_items WHERE organization_id IN (${q})`,
    `DELETE FROM intelligent_items WHERE organization_id IN (${q})`,
    `DELETE FROM price_research WHERE organization_id IN (${q})`,
    `DELETE FROM procurement_processes WHERE organization_id IN (${q})`,
  ];
  for (const sql of stmts) await conn.query(sql).catch(() => { /* tabela/coluna ausente em esquemas antigos */ });
}
