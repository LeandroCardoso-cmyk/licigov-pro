/**
 * Projeções DETERMINÍSTICAS para o Edital institucional (ZERO_REENTRY): leem a autoridade existente e devolvem o valor + a origem
 * (lineage). Sem IA, sem parsing de texto jurídico livre. Fonte única: usada pela composição (`canonicalSources`) e pela
 * preparação (`editalPreparationService`) — o que a UI mostra como "reaproveitado" é exatamente o que o composer consome.
 * Ausência de dado estruturado ⇒ sem projeção (a variável continua pendência humana explicitamente identificada).
 */
import { createHash } from "crypto";
import { getOrganizationById } from "../../db/organizations";
import { getLatestEmittedByOrigin } from "../../db/officialDocuments";
import { getProcess } from "../../db/procurement";
import { PROJECTION_BY_VARIABLE, UF_EXTENSO, type ProjectionKey, type ProjectionOrigin } from "../../domain/institutionalTemplates/editalPreparationModel";
import type { VariableCatalog2 } from "../../domain/institutionalTemplates";
import { resolveProcurementContext } from "../canonicalContextService";

export interface ProjectedValue {
  readonly value: string;
  readonly origin: ProjectionOrigin;
  /** Referência explicável (ids/versões/hashes quando aplicável). */
  readonly ref: Readonly<Record<string, string | number>>;
}

/** Mesmo hash do pin oficial (sha256 do conteúdo): reimplementado aqui para não criar ciclo com o adapter canônico. */
const contentHashOf = (c: string | null | undefined): string => createHash("sha256").update(c ?? "").digest("hex");
const clean = (s: unknown): string | null => (typeof s === "string" && s.replace(/\s+/g, " ").trim() ? s.replace(/\s+/g, " ").trim() : null);

/** Projeções disponíveis para as variáveis DECLARADAS no catálogo (nome da variável → valor + origem). */
export async function resolveEditalProjections(organizationId: number, processId: string, catalog: VariableCatalog2): Promise<Map<string, ProjectedValue>> {
  const out = new Map<string, ProjectedValue>();
  const wanted = new Map<ProjectionKey, string>();
  for (const v of catalog.vars) { const p = PROJECTION_BY_VARIABLE[v.name]; if (p) wanted.set(p.key, v.name); }
  if (wanted.size === 0) return out;
  const put = (key: ProjectionKey, value: string | null, ref: ProjectedValue["ref"]) => {
    const name = wanted.get(key);
    if (name && value) out.set(name, { value, origin: PROJECTION_BY_VARIABLE[name].origin, ref });
  };

  if (wanted.has("PROCESS_OBJECT")) {
    const p = await getProcess(processId, organizationId).catch(() => null);
    put("PROCESS_OBJECT", clean(p?.object), { processId, processNumber: p?.processNumber ?? "" });
  }
  if (wanted.has("REQUESTING_UNIT")) {
    const ctx = await resolveProcurementContext({ organizationId, processId }).catch(() => null);
    const f = ctx?.demand.requestingUnit;
    // Conflito/desconhecido ⇒ sem projeção (a pessoa decide); nunca escolhe entre afirmações divergentes.
    if (f && f.status !== "conflict" && f.status !== "unknown") {
      put("REQUESTING_UNIT", clean(f.value), { sourceType: f.source?.type ?? "", sourceId: f.source?.id ?? "", sourceVersion: f.source?.version ?? "", status: f.status });
    }
  }
  if (wanted.has("ORG_LOCATION") || wanted.has("ORG_UF_EXTENSO")) {
    const org = await getOrganizationById(organizationId).catch(() => null);
    put("ORG_LOCATION", clean(org?.municipio), { organizationId });
    const uf = clean(org?.uf)?.toUpperCase();
    put("ORG_UF_EXTENSO", uf ? UF_EXTENSO[uf] ?? null : null, { organizationId, uf: uf ?? "" });
  }
  if (wanted.has("TR_OBJECT")) {
    const tr = await getLatestEmittedByOrigin(organizationId, "processo_licitatorio", processId, "tr").catch(() => null);
    const object = clean(tr?.metadata?.["object"]);
    if (tr) put("TR_OBJECT", object, { documentId: tr.id, version: tr.version, contentHash: contentHashOf(tr.content) });
  }
  return out;
}
