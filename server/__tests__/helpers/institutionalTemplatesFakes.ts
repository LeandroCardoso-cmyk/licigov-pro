/**
 * Test doubles dos ports de Modelos Institucionais (Lane C): repositório em memória com isolamento por tenant,
 * ledger de decisões (idempotência/CAS) e um composer de teste DETERMINÍSTICO (stand-in da Lane B — não é o composer real).
 */
import { createHash } from "crypto";
import {
  sealGenerationManifest, type BindingResolution, type CompositionManifest, type ComposeInput, type ComposeOutcome, type TemplateBinding,
  type TemplateDocumentKind, type TemplateIdentity, type TemplateNode, type TemplateRevision, type VariableCatalog, type OrgId, type Inline,
} from "../../domain/institutionalTemplates";
import type { InstitutionalDecision } from "../../domain/institutionalDecision";
import type { TemplateCapabilities } from "../../domain/institutionalTemplates/governance/capabilities";
import { InMemoryGovernance } from "./institutionalTemplatesGovernanceFakes";
import { createTemplateReadinessPort } from "../../services/institutionalTemplates/readinessService";
import {
  DuplicateTemplateIdentityError, DuplicateTemplateRevisionError,
  type LifecycleCommit, type LifecycleCommitResult, type TemplateReadinessPort, type TemplateRepositoryPort, type TemplateWorkflowPorts,
} from "../../services/institutionalTemplates/ports";

export const TEST_CATALOG: VariableCatalog = {
  version: "cat-test/1",
  vars: [
    { name: "processo.objeto", type: "string", source: "PROCESS", path: "objeto", required: true },
    { name: "processo.modalidade", type: "enum", source: "PROCESS", path: "modalidade", required: false },
    { name: "parametros.valorEstimado", type: "money", source: "PARAMS", path: "valorEstimado", required: false },
  ],
};

export const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

export const simpleAst = (title = "Termo de Referência") => ({
  schema: "tpl-ast/1" as const,
  root: [
    { t: "heading" as const, level: 1 as const, text: [{ t: "text" as const, v: title }] },
    { t: "paragraph" as const, inline: [{ t: "text" as const, v: "Objeto: " }, { t: "var" as const, name: "processo.objeto" }] },
  ],
});

export class InMemoryTemplateRepository implements TemplateRepositoryPort {
  identities = new Map<string, TemplateIdentity>();
  revisions = new Map<string, TemplateRevision>();
  bindings = new Map<string, TemplateBinding>();
  decisions = new Map<string, InstitutionalDecision>();
  manifestRefs = new Map<string, number>();
  /** Escritas efetivas (para provar "nenhuma escrita" em recusas). */
  writes = 0;
  /** Falha simulada na próxima transição (atomicidade). */
  failNextCommit = false;

  async listIdentities(org: OrgId, filter: { documentKind?: TemplateDocumentKind }) {
    return [...this.identities.values()].filter((i) => i.organizationId === org && (!filter.documentKind || i.documentKind === filter.documentKind));
  }
  async getIdentity(org: OrgId, id: string) { const i = this.identities.get(id); return i && i.organizationId === org ? i : null; }
  async findIdentityBySlug(org: OrgId, kind: TemplateDocumentKind, slug: string) {
    return [...this.identities.values()].find((i) => i.organizationId === org && i.documentKind === kind && i.slug === slug) ?? null;
  }
  async insertIdentity(identity: TemplateIdentity) {
    if (await this.findIdentityBySlug(identity.organizationId, identity.documentKind, identity.slug)) throw new DuplicateTemplateIdentityError();
    this.identities.set(identity.id, identity); this.writes++;
  }
  async listRevisions(org: OrgId, identityId: string) {
    return [...this.revisions.values()].filter((r) => r.organizationId === org && r.identityId === identityId).sort((a, b) => a.revision - b.revision);
  }
  async getRevision(org: OrgId, id: string) { const r = this.revisions.get(id); return r && r.organizationId === org ? r : null; }
  async insertDraftRevision(revision: TemplateRevision) {
    if (revision.status !== "DRAFT") throw new Error("somente DRAFT pode ser inserido");
    if ((await this.listRevisions(revision.organizationId, revision.identityId)).some((r) => r.revision === revision.revision)) throw new DuplicateTemplateRevisionError();
    this.revisions.set(revision.id, revision); this.writes++;
  }
  async updateDraftContent(org: OrgId, before: TemplateRevision, after: TemplateRevision) {
    const cur = await this.getRevision(org, before.id);
    if (!cur || cur.status !== "DRAFT" || cur.semanticHash !== before.semanticHash) return false;
    this.revisions.set(after.id, after); this.writes++; return true;
  }
  async commitLifecycleTransition(c: LifecycleCommit): Promise<LifecycleCommitResult> {
    if (this.failNextCommit) { this.failNextCommit = false; throw new Error("falha simulada na transação"); }
    const byKey = [...this.decisions.values()].find((d) => d.organizationId === c.organizationId && d.idempotencyKey === c.decision.idempotencyKey);
    if (byKey) return byKey.requestHash === c.decision.requestHash ? { status: "REPLAYED", decision: byKey } : { status: "DECISION_IDEMPOTENCY_CONFLICT" };
    // CAS atômico (síncrono entre a leitura e a escrita): duas transições concorrentes nunca passam ambas — como o lock do banco.
    const cur0 = this.revisions.get(c.before.id);
    const cur = cur0 && cur0.organizationId === c.organizationId ? cur0 : null;
    if (!cur || cur.status !== c.expectedStatus) return { status: "STALE_STATUS", currentStatus: cur?.status ?? "DEPRECATED" };
    // atômico: decisão + transição juntas
    this.decisions.set(c.decision.id, c.decision);
    this.revisions.set(c.after.id, c.after);
    this.writes += 2;
    return { status: "COMMITTED", decision: c.decision };
  }
  async countManifestReferences(_org: OrgId, id: string) { return this.manifestRefs.get(id) ?? 0; }
  async listBindings(org: OrgId, f: { documentKind?: TemplateDocumentKind; activeOnly?: boolean }) {
    return [...this.bindings.values()].filter((b) => b.organizationId === org && (!f.documentKind || b.documentKind === f.documentKind) && (!f.activeOnly || b.active));
  }
  async getBinding(org: OrgId, id: string) { const b = this.bindings.get(id); return b && b.organizationId === org ? b : null; }
  async insertBinding(b: TemplateBinding, _ctx?: unknown, replacesBindingId?: string) {
    if (replacesBindingId !== undefined) await this.deactivateBinding(b.organizationId, replacesBindingId);
    this.bindings.set(b.id, b); this.writes++;
  }
  async getDecisionByIdempotencyKey(org: OrgId, key: string) {
    return [...this.decisions.values()].find((d) => d.organizationId === org && d.idempotencyKey === key) ?? null;
  }
  async deactivateBinding(org: OrgId, id: string) {
    const b = await this.getBinding(org, id); if (!b || !b.active) return false;
    this.bindings.set(id, { ...b, active: false }); this.writes++; return true;
  }
}

function inlineText(inl: readonly Inline[], values: Readonly<Record<string, unknown>>): string {
  return inl.map((i) => (i.t === "text" ? i.v : i.t === "var" ? String(values[i.name] ?? "") : inlineText(i.v, values))).join("");
}

/** Stand-in determinístico do composer (Lane B): só concatena texto/variáveis/slots — NÃO avalia condições nem usa IA. */
export function fakeComposer(input: ComposeInput): ComposeOutcome {
  const lines: string[] = [];
  const aiKeys: string[] = [];
  const walk = (nodes: readonly TemplateNode[]): void => nodes.forEach((n) => {
    if (n.t === "heading") lines.push(`# ${inlineText(n.text, input.values)}`);
    else if (n.t === "paragraph") lines.push(inlineText(n.inline, input.values));
    else if (n.t === "section") walk(n.children);
    else if (n.t === "aiSlot") { aiKeys.push(n.slotKey); lines.push(input.aiNarratives[n.slotKey] ?? ""); }
    else if (n.t === "conditional") walk(n.then);
  });
  walk(input.revision.ast.root);
  for (const v of input.catalog.vars) if (v.required && input.values[v.name] === undefined) return { error: "MISSING_REQUIRED" };
  const text = lines.join("\n");
  const sealed = sealGenerationManifest({
    id: "m-preview", createdAt: "1970-01-01T00:00:00.000Z", stage: "GENERATION", organizationId: input.revision.organizationId,
    generatedDocumentId: "preview", templateIdentityId: input.revision.identityId, templateRevisionId: input.revision.id,
    templateSemanticHash: input.revision.semanticHash, hashVersion: input.revision.hashVersion, catalogVersion: input.catalog.version,
    sources: [{ key: "processo", digest: `srcd:${sha("processo")}` }], officialDocRefs: [],
    conditionalDecisions: [], aiNarratives: aiKeys.map((slotKey) => ({ slotKey, executionId: "preview", outputHash: sha(slotKey), humanAccepted: false })),
    annexes: [], identityFingerprint: "fp", composedOutputHash: sha(text),
  });
  if (!sealed.ok) throw new Error(`manifest de teste inválido: ${JSON.stringify(sealed.issues)}`);
  const { id: _id, createdAt: _createdAt, ...manifestDraft } = sealed.value;
  return { content: { text }, manifestDraft };
}

export interface TestPortsOptions {
  repo?: InMemoryTemplateRepository;
  flag?: (org: OrgId) => boolean;
  composer?: (i: ComposeInput) => ComposeOutcome;
  manifests?: Map<string, CompositionManifest>;
  /** `false` ⇒ sem port de governança (procedência/evidência indisponíveis, fail-closed). Padrão: em memória, compartilhando o ledger do repositório. */
  governance?: boolean;
  capabilities?: TemplateCapabilities;
  /** `false` ⇒ sem port de prontidão (publicar Edital falha fechado: READINESS_UNAVAILABLE). Padrão: o port REAL sobre os fakes. */
  readiness?: false | TemplateReadinessPort;
  catalog?: VariableCatalog;
  resolveExactBinding?: (r: Parameters<NonNullable<TemplateWorkflowPorts["composition"]["resolveExactBinding"]>>[0]) => Promise<BindingResolution>;
}

export function makeTestPorts(opts: TestPortsOptions = {}): { ports: TemplateWorkflowPorts; repo: InMemoryTemplateRepository; governance: InMemoryGovernance; composeCalls: ComposeInput[]; ticks: { n: number } } {
  const repo = opts.repo ?? new InMemoryTemplateRepository();
  const governance = new InMemoryGovernance(repo);
  const cat = opts.catalog ?? TEST_CATALOG;
  const composeCalls: ComposeInput[] = [];
  const ticks = { n: 0 };
  const ports: TemplateWorkflowPorts = {
    repository: repo,
    catalog: { current: () => cat, byVersion: (v) => (v === cat.version ? cat : null) },
    composition: {
      previewComposition: (i) => { composeCalls.push(i); return (opts.composer ?? fakeComposer)(i); },
      ...(opts.resolveExactBinding ? { resolveExactBinding: opts.resolveExactBinding } : {}),
    },
    manifests: { getManifest: async (org, id) => { const m = opts.manifests?.get(id); return m && m.organizationId === org ? m : null; } },
    flag: { isEnabled: async (org) => (opts.flag ? opts.flag(org) : true) },
    clock: { now: () => "2026-10-06T12:00:00.000Z" },
    ids: { newId: (p) => `${p}${String(++ticks.n).padStart(6, "0")}` },
    ...(opts.governance === false ? {} : { governance }),
    ...(opts.capabilities ? { capabilities: opts.capabilities } : {}),
  };
  const withReadiness: TemplateWorkflowPorts = opts.readiness === false ? ports
    : { ...ports, readiness: opts.readiness ?? createTemplateReadinessPort(ports) };
  return { ports: withReadiness, repo, governance, composeCalls, ticks };
}

export const decisionInput = (over: Record<string, unknown> = {}) => ({
  decidedByName: "Maria Souza", decidedByRole: "Procuradora-Geral", decidedAt: "2026-10-06",
  basisReference: "Portaria 12/2026", reason: "Conferido pela assessoria jurídica.", ...over,
});
