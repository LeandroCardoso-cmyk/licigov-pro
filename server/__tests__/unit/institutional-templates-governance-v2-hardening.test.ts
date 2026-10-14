/**
 * Template Governance V2 — HARDENING (domínio puro): explainability de integridade
 * (declarado × calculado × semântico × lineage) e adaptador de originais (chave escopada por órgão, preservação verificada por leitura de volta).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { explainIntegrity } from "../../domain/institutionalTemplates/governance/integrityExplanation";
import type { ImportProvenance } from "../../domain/institutionalTemplates/governance/importProvenance";
import type { LegalApprovalEvidence } from "../../domain/institutionalTemplates/governance/legalEvidence";
import type { TemplateOrigin } from "../../domain/institutionalTemplates/governance/templateGovernanceV2";

const store = vi.hoisted(() => ({ objects: new Map<string, Buffer>(), putFail: false, getFail: false, corrupt: false }));
vi.mock("../../storage", () => ({
  storagePut: vi.fn(async (key: string, data: Buffer) => { if (store.putFail) throw new Error("s3 down"); store.objects.set(key, Buffer.from(data)); return { key, url: "u" }; }),
  storageGetBytes: vi.fn(async (key: string) => {
    if (store.getFail) throw new Error("s3 read down");
    const b = store.objects.get(key); if (!b) throw new Error("missing");
    return store.corrupt ? Buffer.concat([b, Buffer.from("x")]) : b;
  }),
  storageExists: vi.fn(async (key: string) => store.objects.has(key)),
}));
import { createTemplateOriginalStoreAdapter, isOwnOriginalKey, originalStorageKey, safeOriginalFilename } from "../../services/institutionalTemplates/adapters/originalStoreAdapter";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const H = (c: string) => c.repeat(64);

const upload: TemplateOrigin = { ownership: "TENANT", source: "TENANT_UPLOAD", lineage: null, declaredAuthor: null,
  original: { sha256: H("b"), sizeBytes: 10, filename: "m.docx", contentType: "x", storageKey: `institutional-templates/1/originals/${H("b")}-m.docx`, preservation: "READBACK_SHA256" } };
const prov = (over: Partial<ImportProvenance> = {}): ImportProvenance => ({
  decisionId: "d", revisionId: "tr1", version: 1, templateKey: "K", displayName: "x", sourceLogicalVersion: "1.0.0", sourceSha256: H("a"), sourceFormat: "DOCX_IMPORT",
  revisionSemanticHash: H("c"), recordedByUserId: 1, recordedAt: "t", inventory: null, scope: {}, origin: upload, originMalformed: false, ...over,
} as ImportProvenance);
const ev = (over: Partial<LegalApprovalEvidence> = {}): LegalApprovalEvidence => ({ decisionId: "e", revisionId: "tr1", version: 1, sourceLogicalVersion: "1.0.0", sourceSha256: H("a"), revisionSemanticHash: H("c"), ...over } as LegalApprovalEvidence);
const rel = (x: ReturnType<typeof explainIntegrity>, id: string) => x.relations.find((r) => r.id === id)!;
const item = (x: ReturnType<typeof explainIntegrity>, id: string) => x.items.find((i) => i.id === id);

describe("explainability de integridade — declarado × calculado × semântico × lineage", () => {
  it("upload: hash declarado é DECLARAÇÃO NÃO VERIFICADA; hash do arquivo é CALCULADO pelo servidor; semântico é DERIVADO — e só os dois últimos são 'garantidos pelo servidor'", () => {
    const x = explainIntegrity({ revisionSemanticHash: H("c"), provenance: prov(), legalEvidence: ev(), lineageProbe: null });
    expect(item(x, "DECLARED_SOURCE_SHA256")).toMatchObject({ assurance: "CLIENT_DECLARED_UNVERIFIED", value: H("a") });
    expect(item(x, "SERVER_FILE_SHA256")).toMatchObject({ assurance: "SERVER_COMPUTED", value: H("b") });
    expect(item(x, "SEMANTIC_HASH")).toMatchObject({ assurance: "SERVER_DERIVED", value: H("c") });
    expect(item(x, "LEGAL_EVIDENCE_SOURCE_SHA256")).toMatchObject({ assurance: "CLIENT_DECLARED_UNVERIFIED" });
    expect([...x.serverAssured].sort()).toEqual(["SEMANTIC_HASH", "SERVER_FILE_SHA256"]);      // nenhuma declaração do cliente vira "verificada"
    expect(x.notices.join(" ")).toMatch(/não são provas criptográficas/);
  });
  it("declarado ≠ arquivo ⇒ DIFFERENT, com explicação de que NÃO é necessariamente erro; declarado = arquivo ⇒ MATCH sem promover a 'aprovação jurídica'", () => {
    const diff = rel(explainIntegrity({ revisionSemanticHash: H("c"), provenance: prov(), legalEvidence: null, lineageProbe: null }), "DECLARED_VS_FILE");
    expect(diff.status).toBe("DIFFERENT"); expect(diff.message).toMatch(/Não é necessariamente erro.*não foi verificada/);
    const same = rel(explainIntegrity({ revisionSemanticHash: H("c"), provenance: prov({ sourceSha256: H("b") }), legalEvidence: null, lineageProbe: null }), "DECLARED_VS_FILE");
    expect(same.status).toBe("MATCH"); expect(same.message).toMatch(/não comprova aprovação jurídica/);
  });
  it("sem arquivo (pacote/AST/derivado): relação NOT_APPLICABLE; pacote da plataforma ⇒ declarado é VERSIONADO pela plataforma", () => {
    const platform: TemplateOrigin = { ownership: "PLATFORM", source: "PLATFORM_CATALOG", original: null, declaredAuthor: null, lineage: { kind: "PLATFORM_PACKAGE", packageKey: "K", packageVersion: "1", sourceSha256: H("a") } };
    const x = explainIntegrity({ revisionSemanticHash: H("c"), provenance: prov({ origin: platform }), legalEvidence: null, lineageProbe: { kind: "PLATFORM_PACKAGE", currentPackageSha256: H("a") } });
    expect(rel(x, "DECLARED_VS_FILE").status).toBe("NOT_APPLICABLE");
    expect(item(x, "DECLARED_SOURCE_SHA256")!.assurance).toBe("PLATFORM_VERSIONED");
    expect(item(x, "SERVER_FILE_SHA256")).toBeUndefined();
    expect(rel(x, "LINEAGE_SOURCE").status).toBe("MATCH");
  });
  it("evidência jurídica com hash de fonte diferente do da procedência ⇒ DIFFERENT (não cobre esta fonte); iguais ⇒ MATCH entre DUAS declarações", () => {
    expect(rel(explainIntegrity({ revisionSemanticHash: H("c"), provenance: prov(), legalEvidence: ev({ sourceSha256: H("d") }), lineageProbe: null }), "DECLARED_VS_EVIDENCE").status).toBe("DIFFERENT");
    const ok = rel(explainIntegrity({ revisionSemanticHash: H("c"), provenance: prov(), legalEvidence: ev(), lineageProbe: null }), "DECLARED_VS_EVIDENCE");
    expect(ok.status).toBe("MATCH"); expect(ok.message).toMatch(/duas declarações/);
    expect(rel(explainIntegrity({ revisionSemanticHash: H("c"), provenance: prov(), legalEvidence: null, lineageProbe: null }), "DECLARED_VS_EVIDENCE").status).toBe("NOT_APPLICABLE");
  });
  it("hash semântico atual ≠ o da procedência ⇒ conteúdo ADAPTADO depois da importação (a procedência descreve a origem, não o conteúdo atual)", () => {
    const x = explainIntegrity({ revisionSemanticHash: H("e"), provenance: prov(), legalEvidence: null, lineageProbe: null });
    expect(rel(x, "SEMANTIC_VS_PROVENANCE")).toMatchObject({ status: "DIFFERENT" });
  });
  it("lineage de revisão do órgão: origem intacta ⇒ MATCH; origem alterada ⇒ DIFFERENT (alerta); inacessível ⇒ UNKNOWN; conteúdo ainda idêntico × adaptado", () => {
    const derived: TemplateOrigin = { ownership: "DERIVED", source: "TENANT_AUTHORED", original: null, declaredAuthor: null, lineage: { kind: "TENANT_REVISION", identityId: "ti1", revisionId: "tr0", semanticHash: H("c") } };
    const base = { provenance: prov({ origin: derived }), legalEvidence: null };
    const intact = explainIntegrity({ ...base, revisionSemanticHash: H("c"), lineageProbe: { kind: "TENANT_REVISION", sourceRevisionSemanticHash: H("c") } });
    expect(rel(intact, "LINEAGE_SOURCE").status).toBe("MATCH"); expect(rel(intact, "CONTENT_VS_LINEAGE").status).toBe("MATCH");
    expect(item(intact, "LINEAGE_REFERENCE")!.assurance).toBe("SERVER_DERIVED");
    const tampered = explainIntegrity({ ...base, revisionSemanticHash: H("e"), lineageProbe: { kind: "TENANT_REVISION", sourceRevisionSemanticHash: H("f") } });
    expect(rel(tampered, "LINEAGE_SOURCE").status).toBe("DIFFERENT"); expect(rel(tampered, "CONTENT_VS_LINEAGE").status).toBe("DIFFERENT");
    expect(rel(explainIntegrity({ ...base, revisionSemanticHash: H("c"), lineageProbe: { kind: "TENANT_REVISION", sourceRevisionSemanticHash: null } }), "LINEAGE_SOURCE").status).toBe("UNKNOWN");
    expect(rel(explainIntegrity({ ...base, revisionSemanticHash: H("c"), lineageProbe: null }), "LINEAGE_SOURCE").status).toBe("UNKNOWN");
  });
  it("pacote da plataforma evoluiu ⇒ DIFFERENT sem alteração automática; pacote indisponível ⇒ UNKNOWN", () => {
    const derived: TemplateOrigin = { ownership: "DERIVED", source: "TENANT_AUTHORED", original: null, declaredAuthor: null, lineage: { kind: "PLATFORM_PACKAGE", packageKey: "K", packageVersion: "1", sourceSha256: H("a") } };
    const mk = (cur: string | null) => rel(explainIntegrity({ revisionSemanticHash: H("c"), provenance: prov({ origin: derived }), legalEvidence: null, lineageProbe: { kind: "PLATFORM_PACKAGE", currentPackageSha256: cur } }), "LINEAGE_SOURCE");
    expect(mk(H("z")).status).toBe("DIFFERENT"); expect(mk(H("z")).message).toMatch(/nenhuma alteração automática/);
    expect(mk(null).status).toBe("UNKNOWN");
  });
  it("sem procedência: só o hash semântico (derivado pelo servidor); nada é inventado", () => {
    const x = explainIntegrity({ revisionSemanticHash: H("c"), provenance: null, legalEvidence: null, lineageProbe: null });
    expect(x.items.map((i) => i.id)).toEqual(["SEMANTIC_HASH"]);
    expect(rel(x, "SEMANTIC_VS_PROVENANCE").status).toBe("NOT_APPLICABLE");
  });
});

describe("adaptador de originais — chave por órgão, preservação VERIFICADA por leitura de volta", () => {
  beforeEach(() => { store.objects.clear(); store.putFail = false; store.getFail = false; store.corrupt = false; });
  const bytes = Buffer.from("conteúdo do modelo");
  const input = (org = 7) => ({ organizationId: org, sha256: sha(bytes), filename: "../../Modelo Ç.docx", contentType: "application/x", bytes });

  it("grava em chave escopada ao órgão, sem travessia, e só devolve após conferir tamanho e SHA-256", async () => {
    const r = await createTemplateOriginalStoreAdapter().put(input());
    expect(r).toMatchObject({ verifiedSha256: sha(bytes), verifiedSizeBytes: bytes.length });
    expect(r.storageKey).toBe(originalStorageKey(7, sha(bytes), "../../Modelo Ç.docx"));
    expect(r.storageKey).toMatch(/^institutional-templates\/7\/originals\/[0-9a-f]{64}-[A-Za-z0-9._-]+$/);
    expect(safeOriginalFilename("..\\..\\x/../.env")).not.toMatch(/[\\/]|^\./);
    expect(isOwnOriginalKey(7, r.storageKey)).toBe(true);
    expect(isOwnOriginalKey(8, r.storageKey)).toBe(false);                       // outro órgão nunca lê esta chave
    expect(isOwnOriginalKey(7, "institutional-templates/7/originals/../8/originals/x")).toBe(false);
  });
  it("falha do put, da leitura de volta ou divergência do conteúdo lido ⇒ REJEITA (nunca devolve storageKey sem verificação)", async () => {
    const a = createTemplateOriginalStoreAdapter();
    store.putFail = true; await expect(a.put(input())).rejects.toThrow(/s3 down/); store.putFail = false;
    store.getFail = true; await expect(a.put(input())).rejects.toThrow(/read down/); store.getFail = false;
    store.corrupt = true; await expect(a.put(input())).rejects.toThrow(/original_readback_mismatch/); store.corrupt = false;
  });
  it("idempotente: mesmo conteúdo ⇒ mesma chave; reverificação sob demanda: VERIFIED · MISMATCH · MISSING · UNAVAILABLE · FORBIDDEN_KEY", async () => {
    const a = createTemplateOriginalStoreAdapter();
    const r1 = await a.put(input()); const r2 = await a.put(input());
    expect(r2.storageKey).toBe(r1.storageKey);
    const v = { organizationId: 7, storageKey: r1.storageKey, sha256: sha(bytes) };
    expect(await a.verify(v)).toEqual({ status: "VERIFIED" });
    store.corrupt = true; expect(await a.verify(v)).toMatchObject({ status: "MISMATCH" }); store.corrupt = false;
    expect(await a.verify({ ...v, storageKey: `institutional-templates/7/originals/${H("9")}-x` })).toEqual({ status: "MISSING" });
    store.getFail = true; expect(await a.verify(v)).toMatchObject({ status: "UNAVAILABLE" }); store.getFail = false;
    expect(await a.verify({ ...v, organizationId: 8 })).toEqual({ status: "FORBIDDEN_KEY" });
  });
});
