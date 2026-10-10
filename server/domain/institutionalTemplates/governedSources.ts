/**
 * Campos GOVERNADOS das fontes canônicas (Institutional Templates — multi-modelo).
 *
 * Parte do que um Edital precisa NÃO existe como dado estruturado no domínio e É decisão humana do órgão/da contratação:
 * configuração do certame, política institucional, decisões de composição (`decisao.*`), prazos e parâmetros do processo,
 * valores "iguais ao TR", versão normativa citada etc. Cada um é registrado, por pessoa, no ledger EXISTENTE
 * `institutional_decisions` (append-only, revisão monotônica com CAS, idempotência, autoridade DECLARADA — nunca validada,
 * `NOT_VALIDATED_POLICY_PENDING`). Nenhum segundo ledger, nenhuma IA, nenhum valor padrão.
 *
 * Contrato `governed-fields/1`: `sections` = { FONTE → { <path do catálogo> → valor } }. A validação reusa o CATÁLOGO da revisão:
 *  - só caminhos que o catálogo declara PARA AQUELA FONTE (chave desconhecida é recusada — nada entra "por acidente");
 *  - valor normalizado pelo tipo do catálogo (`normalizeValue2`); valor inválido é recusado, nunca "consertado";
 *  - caminho cuja autoridade é OUTRA (processo, identidade, itens canônicos, estimativa, divulgação do orçamento) é RECUSADO:
 *    a decisão humana não sobrepõe um dado canônico.
 * O LiciGov NÃO cadastra o certame em nenhuma plataforma: a configuração é a DECISÃO do órgão registrada no sistema.
 * Puro, determinístico, sem I/O.
 */
import { isCanonicalProjection } from "./canonicalProjectionPolicy";
import { isDefaultEligible, validateRoleAssignments, type RoleAssignments } from "./editalAuthorityMatrix";
import { fail, issue, ok, type TemplateIssue, type TemplateResult } from "./types";
import { templateCanonicalJson, templateHash } from "./semanticHash";
import { normalizeValue2 } from "./valueTypes2";
import type { VariableCatalog2, VariableSource2 } from "./variableCatalog2";

export const GOVERNED_FIELDS_SCHEMA = "governed-fields/1";
export const BUDGET_DISCLOSURES = ["publico", "sigiloso"] as const;
export type BudgetDisclosure = (typeof BUDGET_DISCLOSURES)[number];

/** Fontes cujos campos são registrados POR PROCESSO (assunto = id do processo). */
export const PROCESS_SCOPE_SOURCES = ["PROCESS", "TR", "ITEMS", "CERTAME_CONFIG", "NORMATIVE", "BUDGET", "LIFECYCLE"] as const;
/** Fontes cujos campos são registrados POR ÓRGÃO (política institucional e extensão da identidade). */
export const ORG_SCOPE_SOURCES = ["POLICY", "IDENTITY"] as const;
export type ProcessScopeSource = (typeof PROCESS_SCOPE_SOURCES)[number];
export type OrgScopeSource = (typeof ORG_SCOPE_SOURCES)[number];
export type GovernedScope = "PROCESS" | "ORG";

/**
 * Caminhos cuja AUTORIDADE é um dado canônico do domínio (nunca decisão humana). Chaves = `fonte` → caminhos do catálogo.
 * O adapter v2 preenche exatamente estes caminhos a partir do processo, da identidade, dos Itens da contratação, da estimativa
 * e da divulgação do orçamento; um modelo cujo catálogo não declare o caminho simplesmente não o usa.
 */
export const AUTHORITY_OWNED_PATHS: Readonly<Partial<Record<VariableSource2, readonly string[]>>> = Object.freeze({
  PROCESS: ["numeroProcesso", "ano", "orcamentoSigilosoSimNao"],
  IDENTITY: ["municipioNome", "municipioCnpj", "municipioEndereco", "municipioTelefone", "municipioSite"],
  ITEMS: ["quadroItensContratacao"],
  BUDGET: ["valorEstimado"],
});

const MAX_FIELDS_PER_SECTION = 400;
const bad = (path: string, message: string): TemplateIssue => issue("SOURCE_PAYLOAD_INVALID", path, message);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type GovernedFields = Readonly<Record<string, unknown>>;
export interface GovernedParticipation {
  readonly default?: string;
  readonly byLot?: Readonly<Record<string, string>>;
  readonly byItem?: Readonly<Record<string, string>>;
}
/** Padrões institucionais EXPLÍCITOS (nome da variável → valor tipado). Só variáveis elegíveis (Authority Matrix); só escopo ÓRGÃO. */
export type GovernedDefaults = Readonly<Record<string, unknown>>;
export interface RejectedDefault { readonly name: string; readonly reason: string }
export interface GovernedPayload {
  readonly sections: Readonly<Partial<Record<VariableSource2, GovernedFields>>>;
  /** Regime de participação por item/lote declarado pela pessoa (item > lote > padrão); só afeta a coluna do quadro de itens. */
  readonly participation?: GovernedParticipation;
  /** Perfil de Licitações — papéis institucionais (nome/cargo/ato/vigência). Só escopo ÓRGÃO. */
  readonly roles?: RoleAssignments;
  /** Perfil de Licitações — padrões institucionais explícitos. Só escopo ÓRGÃO. Na leitura, padrão incompatível é descartado (`defaultsRejected`). */
  readonly defaults?: GovernedDefaults;
  /** Derivado na leitura (nunca persistido): padrões que o catálogo ATUAL não aceita (incompatível/inelegível) e que NÃO são aplicados. */
  readonly defaultsRejected?: readonly RejectedDefault[];
}

export function allowedSources(scope: GovernedScope): readonly VariableSource2[] {
  return scope === "PROCESS" ? PROCESS_SCOPE_SOURCES : ORG_SCOPE_SOURCES;
}

/** Valida UMA seção contra o catálogo v2 (tipos e caminhos). Devolve os campos normalizados. */
export const CANONICAL_AUTHORITY_OWNED = "CANONICAL_AUTHORITY_OWNED";

/**
 * `mode = "write"` (novo registro humano): recusa também as variáveis de projeção CANONICAL (`CANONICAL_AUTHORITY_OWNED`).
 * `mode = "read"` (padrão; releitura/revalidação do registro corrente): TOLERA valores legados nesses caminhos — o histórico do ledger
 * é preservado e eles são IGNORADOS pela composição e pela preparação (nunca promovidos a autoridade).
 */
export function validateGovernedSection(catalog: VariableCatalog2, scope: GovernedScope, source: string, fields: unknown, mode: "read" | "write" = "read"): TemplateResult<GovernedFields> {
  const allowed = allowedSources(scope) as readonly string[];
  if (!allowed.includes(source)) return fail([bad(source, `fonte ${source} não aceita campos governados neste escopo (${scope})`)]);
  if (!isObj(fields)) return fail([bad(source, "a seção deve ser um objeto { caminho → valor }")]);
  const entries = Object.entries(fields);
  if (entries.length > MAX_FIELDS_PER_SECTION) return fail([bad(source, `seção excede ${MAX_FIELDS_PER_SECTION} campos`)]);
  const owned = new Set(AUTHORITY_OWNED_PATHS[source as VariableSource2] ?? []);
  const byPath = new Map(catalog.vars.filter((v) => v.source === source).map((v) => [v.path, v] as const));
  const issues: TemplateIssue[] = [];
  const out: Record<string, unknown> = {};
  for (const [path, raw] of entries) {
    const def = byPath.get(path);
    if (!def) { issues.push(bad(`${source}.${path}`, "caminho não declarado pelo catálogo para esta fonte")); continue; }
    if (owned.has(path)) { issues.push(bad(`${source}.${path}`, "caminho de autoridade canônica (processo/identidade/itens/estimativa/divulgação): não é decisão humana")); continue; }
    if (mode === "write" && isCanonicalProjection(def.name)) {
      issues.push(bad(`${source}.${path}`, `${CANONICAL_AUTHORITY_OWNED}: a autoridade é canônica (processo/cadastro do órgão); não é decisão humana nem pode ser gravada de novo`));
      continue;
    }
    const norm = normalizeValue2(def, raw);
    if (!norm.ok) { issues.push(bad(`${source}.${path}`, norm.reason)); continue; }
    out[path] = norm.value;
  }
  return issues.length ? fail(issues) : ok(out);
}

/**
 * Valida os PADRÕES institucionais contra o catálogo. `write` (registro novo) é estrito: nome desconhecido, inelegível ou valor
 * inválido é RECUSADO. `read` (releitura do ledger) é tolerante: padrão incompatível com o catálogo atual é descartado e reportado
 * (`rejected`) — nunca aplicado; nomes de OUTROS modelos (não declarados no catálogo) são preservados fora do payload.
 */
export function validateDefaults(catalog: VariableCatalog2, raw: unknown, mode: "read" | "write"): { ok: true; value: GovernedDefaults; rejected: RejectedDefault[] } | { ok: false; issues: TemplateIssue[] } {
  if (!isObj(raw)) return { ok: false, issues: [bad("defaults", "padrões devem ser um objeto { variável → valor }")] };
  const entries = Object.entries(raw);
  if (entries.length > MAX_FIELDS_PER_SECTION) return { ok: false, issues: [bad("defaults", `padrões excedem ${MAX_FIELDS_PER_SECTION} entradas`)] };
  const byName = new Map(catalog.vars.map((v) => [v.name, v] as const));
  const out: Record<string, unknown> = {};
  const rejected: RejectedDefault[] = [];
  const issues: TemplateIssue[] = [];
  for (const [name, value] of entries) {
    const def = byName.get(name);
    if (!def) { if (mode === "write") issues.push(bad(`defaults.${name}`, "variável não declarada pelo catálogo")); continue; } // outro modelo: preservada fora do payload
    const fail1 = (reason: string) => { if (mode === "write") issues.push(bad(`defaults.${name}`, reason)); else rejected.push({ name, reason }); };
    if (!isDefaultEligible(name)) { fail1("variável não elegível a padrão institucional (data do certame, objeto, quantidade, valor ou decisão jurídica casuística)"); continue; }
    if (def.type === "document_ref" || def.type === "table") { fail1("tipo de variável não aceita padrão institucional"); continue; }
    const norm = normalizeValue2(def, value);
    if (!norm.ok) { fail1(norm.reason); continue; }
    out[name] = norm.value;
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: out, rejected };
}

export function validateParticipation(raw: unknown): TemplateResult<GovernedParticipation> {
  if (!isObj(raw) || Object.keys(raw).some((k) => !["default", "byLot", "byItem"].includes(k))) return fail([bad("participation", "participação deve ter apenas default, byLot e byItem")]);
  const issues: TemplateIssue[] = [];
  const text = (path: string, v: unknown) => { if (typeof v !== "string" || v.trim() === "" || v.length > 200) issues.push(bad(path, "regime deve ser texto não vazio (até 200)")); };
  if (raw.default !== undefined) text("participation.default", raw.default);
  for (const k of ["byLot", "byItem"] as const) {
    const m = raw[k];
    if (m === undefined) continue;
    if (!isObj(m) || Object.keys(m).length > 500) { issues.push(bad(`participation.${k}`, "mapa inválido (até 500 entradas)")); continue; }
    for (const [ref, regime] of Object.entries(m)) { if (ref.trim() === "" || ref.length > 64) issues.push(bad(`participation.${k}.${ref}`, "referência vazia ou longa demais")); text(`participation.${k}.${ref}`, regime); }
  }
  return issues.length ? fail(issues) : ok(raw as GovernedParticipation);
}

/** Regime de participação declarado para um item: item > lote > padrão; ausente ⇒ `null` (nunca inferido). */
export function participationRegimeFor(p: GovernedParticipation | undefined | null, ref: { readonly itemKey: string; readonly lotCode: string | null }): string | null {
  if (!p) return null;
  return p.byItem?.[ref.itemKey] ?? (ref.lotCode ? p.byLot?.[ref.lotCode] : undefined) ?? p.default ?? null;
}

/** Aplica campos (caminho pontuado → valor) sobre um objeto de dados aninhado. Colisão de prefixo é erro (nunca sobrescreve). */
export function applyFieldsToData(data: Record<string, unknown>, fields: GovernedFields): void {
  for (const [path, value] of Object.entries(fields)) {
    const segs = path.split(".");
    let cur = data;
    for (const seg of segs.slice(0, -1)) {
      const next = cur[seg];
      if (next === undefined) cur[seg] = {};
      else if (!isObj(next)) throw new Error(`campo governado colide com valor existente em ${path}`);
      cur = cur[seg] as Record<string, unknown>;
    }
    const leaf = segs[segs.length - 1];
    if (Object.prototype.hasOwnProperty.call(cur, leaf)) throw new Error(`campo governado duplicado em ${path}`);
    cur[leaf] = value;
  }
}

// ─── Codec do payload em `evidence` (ledger existente) ───────────────────────────────────────────────────────────

export interface EncodedPayload { readonly evidence: string[]; readonly hash: string }

/** `evidence = [schema:<s>, payload:<JSON canônico>, hash:<sha256 do payload canônico>]` (uma linha cada). */
export function encodeGovernedPayload(schema: string, payload: unknown): EncodedPayload {
  const json = templateCanonicalJson(payload);
  const hash = templateHash(payload);
  return { evidence: [`schema:${schema}`, `payload:${json}`, `hash:${hash}`], hash };
}

/** Decodifica e VERIFICA a integridade: schema esperado, JSON válido e hash recalculado. Qualquer divergência ⇒ `null`. */
export function decodeGovernedPayload(evidence: readonly string[], expectedSchema: string): { payload: unknown; hash: string } | null {
  const pick = (name: string) => evidence.find((e) => e.startsWith(`${name}:`))?.slice(name.length + 1) ?? null;
  const schema = pick("schema"), json = pick("payload"), hash = pick("hash");
  if (schema !== expectedSchema || json === null || hash === null) return null;
  let payload: unknown;
  try { payload = JSON.parse(json); } catch { return null; }
  return templateHash(payload) === hash && templateCanonicalJson(payload) === json ? { payload, hash } : null;
}

/** Caminhos que o catálogo declara para a fonte (os demais campos do registro pertencem a OUTRO modelo e são preservados/ignorados). */
export function declaredPaths(catalog: VariableCatalog2, source: string): ReadonlySet<string> {
  return new Set(catalog.vars.filter((v) => v.source === source).map((v) => v.path));
}

/**
 * Valida o payload decodificado de um registro (forma `governed-fields/1`) contra o catálogo; nunca "meio válido".
 * Um órgão/processo pode servir a VÁRIOS modelos (catálogos diferentes): os campos que o catálogo NÃO declara pertencem a outro
 * modelo e são IGNORADOS na leitura (não entram nos dados nem no digest); os que ele declara são validados por tipo.
 */
export function validateGovernedPayload(catalog: VariableCatalog2, scope: GovernedScope, raw: unknown): TemplateResult<GovernedPayload> {
  if (!isObj(raw) || !isObj(raw.sections) || Object.keys(raw).some((k) => !["sections", "participation", "roles", "defaults"].includes(k))) return fail([bad("", "payload deve ter { sections, participation?, roles?, defaults? }")]);
  const issues: TemplateIssue[] = [];
  const sections: Partial<Record<VariableSource2, GovernedFields>> = {};
  for (const [source, fields] of Object.entries(raw.sections)) {
    const mine = isObj(fields) ? Object.fromEntries(Object.entries(fields).filter(([p]) => declaredPaths(catalog, source).has(p))) : fields;
    const r = validateGovernedSection(catalog, scope, source, mine);
    if (!r.ok) issues.push(...r.issues); else sections[source as VariableSource2] = r.value;
  }
  let participation: GovernedParticipation | undefined;
  if (raw.participation !== undefined) {
    if (scope !== "PROCESS") issues.push(bad("participation", "participação só existe no escopo do processo"));
    else { const p = validateParticipation(raw.participation); if (!p.ok) issues.push(...p.issues); else participation = p.value; }
  }
  let roles: RoleAssignments | undefined;
  if (raw.roles !== undefined) {
    if (scope !== "ORG") issues.push(bad("roles", "papéis institucionais só existem no escopo do órgão"));
    else { const r = validateRoleAssignments(raw.roles); if (!r.ok) issues.push(...r.issues.map((m) => bad("roles", m))); else roles = r.value; }
  }
  let defaults: GovernedDefaults | undefined;
  let defaultsRejected: RejectedDefault[] | undefined;
  if (raw.defaults !== undefined) {
    if (scope !== "ORG") issues.push(bad("defaults", "padrões institucionais só existem no escopo do órgão"));
    else { const d = validateDefaults(catalog, raw.defaults, "read"); if (!d.ok) issues.push(...d.issues); else { defaults = d.value; if (d.rejected.length) defaultsRejected = d.rejected; } }
  }
  return issues.length ? fail(issues) : ok({
    sections, ...(participation ? { participation } : {}), ...(roles ? { roles } : {}), ...(defaults ? { defaults } : {}), ...(defaultsRejected ? { defaultsRejected } : {}),
  });
}
