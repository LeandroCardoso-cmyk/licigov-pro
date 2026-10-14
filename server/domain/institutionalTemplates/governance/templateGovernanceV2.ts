/**
 * TEMPLATE GOVERNANCE V2 — contratos de domínio puros (ADR-TG-V2, `docs/architecture/TEMPLATE_GOVERNANCE_V2.md`).
 *
 * Duas decisões de produto:
 *  1. O LiciGov Pro ELABORA documentos; não publica nada oficialmente. Publicar um TEMPLATE no catálogo interno
 *     (`TEMPLATE_CATALOG_PUBLICATION`) NÃO é publicar um edital/contratação (`OFFICIAL_DOCUMENT_PUBLICATION`) e não é status jurídico de
 *     documento. A análise jurídica dos DOCUMENTOS pertence à Procuradoria, na fase institucional própria (`DOCUMENT_LEGAL_REVIEW`).
 *     A evidência jurídica PRÉVIA de um template deixa de ser universal: é exigida só quando a política institucional aplicável a exige.
 *  2. Cada prefeitura usa os SEUS modelos: de plataforma (`PLATFORM`), próprios (`TENANT`) ou adaptados (`DERIVED`, com lineage).
 *
 * Nada aqui lê relógio, banco ou rede. Persistência: ledger institucional existente (sem schema novo). Nada é presumido nem fabricado:
 * política ausente ⇒ padrão da PLATAFORMA (que hoje PRESERVA o comportamento anterior: evidência exigida); registro ilegível ⇒ padrão estrito.
 */
import type { InstitutionalDecision } from "../../institutionalDecision";
import { isSha256 } from "../types";
import { decodeKv, encodeKv } from "./kv";

// ─── Separação conceitual de publicação e das camadas de prontidão ───────────────────────────────────────────────────

/** `TEMPLATE_CATALOG_PUBLICATION`: tornar uma revisão de modelo disponível para ELABORAÇÃO (interna). `OFFICIAL_DOCUMENT_PUBLICATION`: publicar documento oficial — fora do produto. */
export const PUBLICATION_KINDS = ["TEMPLATE_CATALOG_PUBLICATION", "OFFICIAL_DOCUMENT_PUBLICATION"] as const;
export type PublicationKind = (typeof PUBLICATION_KINDS)[number];
/** A transição PUBLISHED de uma revisão de modelo é SEMPRE `TEMPLATE_CATALOG_PUBLICATION`; o produto não implementa a outra (nenhuma publicação externa automática). */
export const REVISION_PUBLISH_MEANING: PublicationKind = "TEMPLATE_CATALOG_PUBLICATION";

/**
 * Camadas do que se verifica:
 *  - `TECHNICAL_TEMPLATE_READINESS`: provas técnicas/estruturais para disponibilizar o modelo (sempre exigidas, nunca dispensáveis por política);
 *  - `TENANT_TEMPLATE_POLICY`: exigências institucionais adicionais do órgão sobre seus modelos (p.ex. evidência jurídica prévia) — configuráveis;
 *  - `DOCUMENT_LEGAL_REVIEW`: controle jurídico dos DOCUMENTOS elaborados (workflows documentais próprios; nunca é gate de template).
 */
export const READINESS_LAYERS = ["TECHNICAL_TEMPLATE_READINESS", "TENANT_TEMPLATE_POLICY", "DOCUMENT_LEGAL_REVIEW"] as const;
export type ReadinessLayer = (typeof READINESS_LAYERS)[number];

// ─── Origem do template: ownership · source · lineage ───────────────────────────────────────────────────────────────

export const TEMPLATE_OWNERSHIPS = ["PLATFORM", "TENANT", "DERIVED"] as const;
export type TemplateOwnership = (typeof TEMPLATE_OWNERSHIPS)[number];
export const TEMPLATE_SOURCES = ["PLATFORM_CATALOG", "TENANT_UPLOAD", "TENANT_AUTHORED"] as const;
export type TemplateSource = (typeof TEMPLATE_SOURCES)[number];

/** Combinações válidas (ownership → fontes admissíveis). */
export const ORIGIN_ALLOWED_SOURCES: Readonly<Record<TemplateOwnership, readonly TemplateSource[]>> = Object.freeze({
  PLATFORM: ["PLATFORM_CATALOG"],
  TENANT: ["TENANT_UPLOAD", "TENANT_AUTHORED"],
  DERIVED: ["TENANT_AUTHORED"],
});

export type TemplateLineage =
  /** Derivado de um pacote versionado da plataforma. */
  | { readonly kind: "PLATFORM_PACKAGE"; readonly packageKey: string; readonly packageVersion: string; readonly sourceSha256: string }
  /** Derivado de uma revisão EXATA de um modelo do MESMO órgão (nunca de outro tenant). */
  | { readonly kind: "TENANT_REVISION"; readonly identityId: string; readonly revisionId: string; readonly semanticHash: string };

/** Arquivo original enviado pela prefeitura (preservado e identificado por SHA-256 calculado NO SERVIDOR). */
export interface TemplateOriginalFile {
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly filename: string | null;
  readonly contentType: string | null;
  /** Chave no armazenamento (S3) — `null` quando o armazenamento não está configurado (explícito, nunca omitido em silêncio). */
  readonly storageKey: string | null;
}

export interface TemplateOrigin {
  readonly ownership: TemplateOwnership;
  readonly source: TemplateSource;
  readonly lineage: TemplateLineage | null;
  readonly original: TemplateOriginalFile | null;
  /** Autoria declarada por quem cadastrou (texto livre curto; informativa, nunca validada). */
  readonly declaredAuthor: string | null;
}

export interface OriginIssue { readonly field: string; readonly message: string }

const SHORT = /^[^\r\n]{1,160}$/;
const KEY_RE = /^[A-Za-z0-9_.\-/]{1,300}$/;

export function validateTemplateOrigin(o: TemplateOrigin): OriginIssue[] {
  const out: OriginIssue[] = [];
  if (!(TEMPLATE_OWNERSHIPS as readonly string[]).includes(o.ownership)) out.push({ field: "ownership", message: "ownership inválido" });
  else if (!(TEMPLATE_SOURCES as readonly string[]).includes(o.source)) out.push({ field: "source", message: "source inválido" });
  else if (!ORIGIN_ALLOWED_SOURCES[o.ownership].includes(o.source)) out.push({ field: "source", message: `a origem ${o.source} não é admissível para o ownership ${o.ownership}` });
  if (o.ownership === "DERIVED" && !o.lineage) out.push({ field: "lineage", message: "modelo derivado exige lineage (de onde foi derivado)" });
  if (o.ownership === "TENANT" && o.lineage) out.push({ field: "lineage", message: "modelo próprio não tem lineage (use DERIVED ao adaptar outro modelo)" });
  if (o.ownership === "PLATFORM" && o.lineage && o.lineage.kind !== "PLATFORM_PACKAGE") out.push({ field: "lineage", message: "modelo da plataforma só pode ter lineage de pacote da plataforma" });
  if (o.lineage?.kind === "PLATFORM_PACKAGE") {
    if (!SHORT.test(o.lineage.packageKey) || !SHORT.test(o.lineage.packageVersion) || !isSha256(o.lineage.sourceSha256)) out.push({ field: "lineage", message: "lineage de pacote inválido (chave, versão, SHA-256)" });
  }
  if (o.lineage?.kind === "TENANT_REVISION" && (!KEY_RE.test(o.lineage.identityId) || !KEY_RE.test(o.lineage.revisionId) || !isSha256(o.lineage.semanticHash))) out.push({ field: "lineage", message: "lineage de revisão inválido (identidade, revisão, hash semântico)" });
  if (o.source === "TENANT_UPLOAD" && !o.original) out.push({ field: "original", message: "modelo enviado exige o SHA-256 do arquivo original" });
  if (o.source !== "TENANT_UPLOAD" && o.original) out.push({ field: "original", message: "só modelos enviados (TENANT_UPLOAD) têm arquivo original" });
  if (o.original) {
    if (!isSha256(o.original.sha256)) out.push({ field: "original.sha256", message: "SHA-256 do original inválido" });
    if (!Number.isSafeInteger(o.original.sizeBytes) || o.original.sizeBytes < 0) out.push({ field: "original.sizeBytes", message: "tamanho do original inválido" });
    if (o.original.filename !== null && !SHORT.test(o.original.filename)) out.push({ field: "original.filename", message: "nome do arquivo inválido" });
    if (o.original.contentType !== null && !SHORT.test(o.original.contentType)) out.push({ field: "original.contentType", message: "tipo do arquivo inválido" });
    if (o.original.storageKey !== null && !KEY_RE.test(o.original.storageKey)) out.push({ field: "original.storageKey", message: "chave de armazenamento inválida" });
  }
  if (o.declaredAuthor !== null && !SHORT.test(o.declaredAuthor)) out.push({ field: "declaredAuthor", message: "autoria declarada inválida (uma linha, até 160 caracteres)" });
  return out;
}

/**
 * Origem INFERIDA pelo servidor a partir do tipo de fonte do registro — o cliente nunca declara `ownership` (não pode se passar por plataforma).
 * Pacote versionado ⇒ PLATFORM; Markdown/DOCX ⇒ TENANT enviado; AST ⇒ TENANT redigido.
 */
export function inferOriginFromRegistration(src:
  | { readonly kind: "MODEL_PACKAGE"; readonly packageKey: string; readonly packageVersion: string; readonly sourceSha256: string }
  | { readonly kind: "MARKDOWN" | "DOCX"; readonly original: TemplateOriginalFile }
  | { readonly kind: "AST" }, declaredAuthor: string | null = null): TemplateOrigin {
  if (src.kind === "MODEL_PACKAGE") {
    return { ownership: "PLATFORM", source: "PLATFORM_CATALOG", lineage: { kind: "PLATFORM_PACKAGE", packageKey: src.packageKey, packageVersion: src.packageVersion, sourceSha256: src.sourceSha256 }, original: null, declaredAuthor };
  }
  if (src.kind === "AST") return { ownership: "TENANT", source: "TENANT_AUTHORED", lineage: null, original: null, declaredAuthor };
  return { ownership: "TENANT", source: "TENANT_UPLOAD", lineage: null, original: src.original, declaredAuthor };
}

/** A origem registrada é imutável: uma nova versão da procedência só pode REPETIR a origem (ou classificar um registro legado que não tinha). */
export function originChangeIssue(current: TemplateOrigin | null, next: TemplateOrigin | null): string | null {
  if (!current) return null;
  if (!next) return "a procedência já tem origem registrada; ela é imutável e não pode ser removida";
  return JSON.stringify(originCanonical(current)) === JSON.stringify(originCanonical(next)) ? null : "a origem registrada (ownership, fonte, lineage, original) é imutável; crie nova revisão/identidade em vez de alterá-la";
}

function originCanonical(o: TemplateOrigin): unknown {
  return [o.ownership, o.source, o.lineage, o.original ? [o.original.sha256, o.original.sizeBytes, o.original.filename, o.original.contentType, o.original.storageKey] : null, o.declaredAuthor];
}

// codec `origin.*` (linhas de evidência da procedência; o ledger existente guarda a lista de textos)
export const ORIGIN_KEYS = [
  "origin.ownership", "origin.source", "origin.author",
  "origin.lineage.kind", "origin.lineage.identityId", "origin.lineage.revisionId", "origin.lineage.semanticHash",
  "origin.lineage.packageKey", "origin.lineage.packageVersion", "origin.lineage.sourceSha256",
  "origin.original.sha256", "origin.original.sizeBytes", "origin.original.filename", "origin.original.contentType", "origin.original.storageKey",
] as const;

export function encodeTemplateOrigin(o: TemplateOrigin): string[] {
  const l: string[] = [encodeKv("origin.ownership", o.ownership), encodeKv("origin.source", o.source)];
  if (o.declaredAuthor) l.push(encodeKv("origin.author", o.declaredAuthor));
  if (o.lineage?.kind === "PLATFORM_PACKAGE") l.push(encodeKv("origin.lineage.kind", "PLATFORM_PACKAGE"), encodeKv("origin.lineage.packageKey", o.lineage.packageKey), encodeKv("origin.lineage.packageVersion", o.lineage.packageVersion), encodeKv("origin.lineage.sourceSha256", o.lineage.sourceSha256));
  if (o.lineage?.kind === "TENANT_REVISION") l.push(encodeKv("origin.lineage.kind", "TENANT_REVISION"), encodeKv("origin.lineage.identityId", o.lineage.identityId), encodeKv("origin.lineage.revisionId", o.lineage.revisionId), encodeKv("origin.lineage.semanticHash", o.lineage.semanticHash));
  if (o.original) {
    l.push(encodeKv("origin.original.sha256", o.original.sha256), encodeKv("origin.original.sizeBytes", String(o.original.sizeBytes)));
    if (o.original.filename) l.push(encodeKv("origin.original.filename", o.original.filename));
    if (o.original.contentType) l.push(encodeKv("origin.original.contentType", o.original.contentType));
    if (o.original.storageKey) l.push(encodeKv("origin.original.storageKey", o.original.storageKey));
  }
  return l;
}

/** Origem decodificada das linhas; `null` = sem origem (registro legado) OU registro ilegível (`malformed` distingue). */
export function decodeTemplateOrigin(lines: readonly string[]): { readonly origin: TemplateOrigin | null; readonly malformed: boolean } {
  const { values: v } = decodeKv(lines, ORIGIN_KEYS);
  if (!v["origin.ownership"] && !v["origin.source"]) return { origin: null, malformed: false };
  const ownership = v["origin.ownership"] as TemplateOwnership; const source = v["origin.source"] as TemplateSource;
  let lineage: TemplateLineage | null = null;
  if (v["origin.lineage.kind"] === "PLATFORM_PACKAGE") {
    lineage = { kind: "PLATFORM_PACKAGE", packageKey: v["origin.lineage.packageKey"] ?? "", packageVersion: v["origin.lineage.packageVersion"] ?? "", sourceSha256: v["origin.lineage.sourceSha256"] ?? "" };
  } else if (v["origin.lineage.kind"] === "TENANT_REVISION") {
    lineage = { kind: "TENANT_REVISION", identityId: v["origin.lineage.identityId"] ?? "", revisionId: v["origin.lineage.revisionId"] ?? "", semanticHash: v["origin.lineage.semanticHash"] ?? "" };
  } else if (v["origin.lineage.kind"] !== undefined) return { origin: null, malformed: true };
  const original: TemplateOriginalFile | null = v["origin.original.sha256"] !== undefined
    ? { sha256: v["origin.original.sha256"], sizeBytes: /^\d{1,12}$/.test(v["origin.original.sizeBytes"] ?? "") ? Number(v["origin.original.sizeBytes"]) : -1, filename: v["origin.original.filename"] ?? null, contentType: v["origin.original.contentType"] ?? null, storageKey: v["origin.original.storageKey"] ?? null }
    : null;
  const origin: TemplateOrigin = { ownership, source, lineage, original, declaredAuthor: v["origin.author"] ?? null };
  return validateTemplateOrigin(origin).length ? { origin: null, malformed: true } : { origin, malformed: false };
}

// ─── Política de governança de templates (por organização) ───────────────────────────────────────────────────────────

export const TEMPLATE_GOVERNANCE_POLICY_KINDS = ["PLATFORM_DEFAULT", "TENANT_DEFINED"] as const;
export type TemplateGovernancePolicyKind = (typeof TEMPLATE_GOVERNANCE_POLICY_KINDS)[number];

/** Exigência de evidência jurídica PRÉVIA do template para a publicação no catálogo interno. */
export type LegalEvidenceRequirement = "REQUIRED" | "OPTIONAL";
/** Piso de papel para aprovar/publicar: só pode ser ELEVADO acima do mínimo da plataforma (`manager`), nunca reduzido. */
export type TemplateRoleFloor = "manager" | "owner";
export const TEMPLATE_ROLE_FLOORS: readonly TemplateRoleFloor[] = ["manager", "owner"];
const ROLE_RANK: Readonly<Record<string, number>> = { viewer: 0, operator: 1, manager: 2, owner: 3 };
export const roleMeetsFloor = (role: string | null | undefined, floor: TemplateRoleFloor): boolean => role != null && role in ROLE_RANK && ROLE_RANK[role] >= ROLE_RANK[floor];

export interface TemplateGovernancePolicy {
  readonly legalEvidence: LegalEvidenceRequirement;
  readonly approveMinRole: TemplateRoleFloor;
  readonly publishMinRole: TemplateRoleFloor;
}

/**
 * Padrão da PLATAFORMA. TRANSIÇÃO: o comportamento anterior (evidência jurídica exigida para publicar modelo de Edital) é PRESERVADO como padrão até que o
 * Owner aprove a política de transição; um órgão pode, ele mesmo e de forma auditável, definir `OPTIONAL` (ADR-TG-V2 §Rollout). Para tornar OPCIONAL o padrão
 * da plataforma, altere SOMENTE esta constante (com a decisão registrada) — nenhum dado persistido precisa mudar.
 */
export const PLATFORM_DEFAULT_POLICY: TemplateGovernancePolicy = Object.freeze({ legalEvidence: "REQUIRED", approveMinRole: "manager", publishMinRole: "manager" });

export const TEMPLATE_POLICY_SCHEMA = "tpl-governance-policy/1" as const;
/** Assunto da política no ledger ORG existente (`institutional.policy`; lock da linha da organização). Distinto do assunto dos campos governados. */
export const TEMPLATE_POLICY_SUBJECT_ID = "template-governance-policy" as const;

export interface EffectiveTemplateGovernancePolicy {
  readonly kind: TemplateGovernancePolicyKind;
  readonly policy: TemplateGovernancePolicy;
  /** Decisão do ledger que a estabeleceu (`null` = padrão da plataforma). */
  readonly decisionId: string | null;
  readonly version: number;
  /** `true` quando a decisão corrente não pôde ser lida: vale o padrão ESTRITO e a UX/relatórios devem alertar (nunca relaxa em silêncio). */
  readonly malformed: boolean;
}

/** Política ESTRITA usada quando o registro corrente da política é ilegível: nunca relaxa (independe do padrão da plataforma). */
export const STRICT_FALLBACK_POLICY: TemplateGovernancePolicy = Object.freeze({ legalEvidence: "REQUIRED", approveMinRole: "manager", publishMinRole: "manager" });

export const PLATFORM_DEFAULT_EFFECTIVE: EffectiveTemplateGovernancePolicy = Object.freeze({ kind: "PLATFORM_DEFAULT", policy: PLATFORM_DEFAULT_POLICY, decisionId: null, version: 0, malformed: false });

export function validateTemplateGovernancePolicy(p: TemplateGovernancePolicy): { field: string; message: string }[] {
  const out: { field: string; message: string }[] = [];
  if (p.legalEvidence !== "REQUIRED" && p.legalEvidence !== "OPTIONAL") out.push({ field: "legalEvidence", message: "legalEvidence deve ser REQUIRED ou OPTIONAL" });
  if (!TEMPLATE_ROLE_FLOORS.includes(p.approveMinRole)) out.push({ field: "approveMinRole", message: "piso de aprovação: manager ou owner (nunca abaixo de manager)" });
  if (!TEMPLATE_ROLE_FLOORS.includes(p.publishMinRole)) out.push({ field: "publishMinRole", message: "piso de publicação: manager ou owner (nunca abaixo de manager)" });
  return out;
}

export function encodeTemplateGovernancePolicy(p: TemplateGovernancePolicy): string[] {
  return [encodeKv("schema", TEMPLATE_POLICY_SCHEMA), encodeKv("legalEvidence", p.legalEvidence), encodeKv("approveMinRole", p.approveMinRole), encodeKv("publishMinRole", p.publishMinRole)];
}

export function decodeTemplateGovernancePolicy(d: InstitutionalDecision): TemplateGovernancePolicy | null {
  if (d.subjectType !== "institutional.policy" || d.subjectId !== TEMPLATE_POLICY_SUBJECT_ID || d.decisionType !== "institutional_policy" || d.outcome !== "estabelecida") return null;
  const { values: v } = decodeKv(d.evidence, ["schema", "legalEvidence", "approveMinRole", "publishMinRole"]);
  if (v.schema !== TEMPLATE_POLICY_SCHEMA) return null;
  const policy = { legalEvidence: v.legalEvidence, approveMinRole: v.approveMinRole, publishMinRole: v.publishMinRole } as TemplateGovernancePolicy;
  return validateTemplateGovernancePolicy(policy).length ? null : policy;
}

/** Política EFETIVA a partir do histórico do assunto (ordem de versão). Ausente ⇒ padrão da plataforma; corrente ilegível ⇒ padrão estrito + `malformed`. */
export function resolveEffectiveTemplateGovernancePolicy(history: readonly InstitutionalDecision[]): EffectiveTemplateGovernancePolicy {
  if (history.length === 0) return PLATFORM_DEFAULT_EFFECTIVE;
  const current = history[history.length - 1];
  const decoded = decodeTemplateGovernancePolicy(current);
  if (!decoded) return { kind: "PLATFORM_DEFAULT", policy: STRICT_FALLBACK_POLICY, decisionId: current.id, version: current.revision, malformed: true };
  return { kind: "TENANT_DEFINED", policy: decoded, decisionId: current.id, version: current.revision, malformed: false };
}
