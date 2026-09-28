/**
 * R3 / PR-06 — Create ≠ Reset (SEM-006 parecer, SEM-007 contrato) — contrato PURO, sem banco.
 *
 * Complementa o smoke MySQL `create-not-reset-legal-contract-mysql-smoke.test.ts`: fixa as regras de decisão
 * (convergência só no retry EXATO da mesma criação; tudo o mais é CONFLICT com token estável) e congela, na fonte, que
 * os caminhos de criação não voltam a usar upsert.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  createLegalOpinionDraft, signLegalOpinionDraft, updateLegalOpinionDraft,
  decideLegalOpinionDraftCreate, isSameLegalOpinionDraftCreate,
  LEGAL_OPINION_ALREADY_EXISTS, LEGAL_OPINION_ALREADY_SIGNED, LEGAL_OPINION_STAGE_INVALID,
  LEGAL_OPINION_ALREADY_EXISTS_MESSAGE, LEGAL_OPINION_ALREADY_SIGNED_MESSAGE, legalOpinionStageInvalidMessage,
} from "../../domain/legalOpinionDraft";
import { createContractWorkspace } from "../../domain/contractWorkspace";
import {
  CONTRACT_ALREADY_EXISTS, contractAlreadyExistsMessage, isSameContractCreate, decideContractCreateOnExisting,
} from "../../domain/contractCreation";
import { ContractAlreadyExistsError, ManualContractConflictError } from "../../services/contractService";

const ORG = 7001;
const base = {
  organizationId: ORG, workspaceId: "ws-1", requestId: "req-1", opinionType: "LEGAL_OPINION_INITIAL" as const,
  author: 11, report: "R", foundation: "F", conclusion: "C", conclusionType: "favoravel" as const, correlationId: "c1",
};

describe("R3 / PR-06 — parecer: decisão de criação (SEM-006)", () => {
  it("sem parecer existente ⇒ create", () => {
    expect(decideLegalOpinionDraftCreate([], createLegalOpinionDraft(base))).toEqual({ kind: "create" });
  });

  it("retry exato (mesmo ator, tipo e payload normalizado; rascunho v1) ⇒ converge para o existente", () => {
    const existing = createLegalOpinionDraft({ ...base, createdAt: "2026-01-01T00:00:00.000Z" });
    const retry = createLegalOpinionDraft({ ...base, recommendations: [], reservations: [], attachments: [], correlationId: "c2" });
    expect(isSameLegalOpinionDraftCreate(existing, retry)).toBe(true);
    expect(decideLegalOpinionDraftCreate([existing], retry)).toEqual({ kind: "converge", draft: existing });
  });

  it("qualquer diferença de payload, ator ou tipo ⇒ CONFLICT LEGAL_OPINION_ALREADY_EXISTS", () => {
    const existing = createLegalOpinionDraft(base);
    for (const variant of [
      { report: "R2" }, { foundation: "F2" }, { conclusion: "C2" }, { conclusionType: "desfavoravel" as const },
      { recommendations: ["x"] }, { reservations: ["y"] }, { attachments: ["z"] }, { author: 12 },
      { opinionType: "LEGAL_OPINION_FINAL" as const },
    ]) {
      const candidate = createLegalOpinionDraft({ ...base, ...variant });
      expect(decideLegalOpinionDraftCreate([existing], candidate)).toEqual({ kind: "conflict", reason: LEGAL_OPINION_ALREADY_EXISTS });
    }
  });

  it("parecer já editado (v2) não converge com o payload original da criação", () => {
    const edited = updateLegalOpinionDraft(createLegalOpinionDraft(base), {});
    expect(edited.version).toBe(2);
    expect(decideLegalOpinionDraftCreate([edited], createLegalOpinionDraft(base)).kind).toBe("conflict");
  });

  it("parecer ASSINADO (qualquer tipo) ⇒ CONFLICT LEGAL_OPINION_ALREADY_SIGNED, mesmo com o payload idêntico", () => {
    const signed = signLegalOpinionDraft(createLegalOpinionDraft(base), "manual", 11);
    expect(decideLegalOpinionDraftCreate([signed], createLegalOpinionDraft(base)))
      .toEqual({ kind: "conflict", reason: LEGAL_OPINION_ALREADY_SIGNED });
    expect(decideLegalOpinionDraftCreate([signed], createLegalOpinionDraft({ ...base, opinionType: "LEGAL_OPINION_FINAL" })))
      .toEqual({ kind: "conflict", reason: LEGAL_OPINION_ALREADY_SIGNED });
  });

  it("mensagens pt-BR estáveis carregam o token", () => {
    expect(LEGAL_OPINION_ALREADY_EXISTS_MESSAGE).toContain(LEGAL_OPINION_ALREADY_EXISTS);
    expect(LEGAL_OPINION_ALREADY_EXISTS_MESSAGE).toMatch(/^Já existe um parecer/);
    expect(LEGAL_OPINION_ALREADY_SIGNED_MESSAGE).toContain(LEGAL_OPINION_ALREADY_SIGNED);
    expect(LEGAL_OPINION_ALREADY_SIGNED_MESSAGE).toMatch(/assinado.*imutável/);
    expect(legalOpinionStageInvalidMessage("ARCHIVED")).toContain(LEGAL_OPINION_STAGE_INVALID);
    expect(legalOpinionStageInvalidMessage("ARCHIVED")).toContain("ARCHIVED");
  });
});

describe("R3 / PR-06 — contrato: decisão de criação (SEM-007)", () => {
  const p = {
    organizationId: ORG, originType: "processo_licitatorio" as const, originProcess: "proc-1", contractNumber: "CT-1",
    contractor: "Fornecedor", object: "Objeto", value: 1234.5, term: "12 meses", correlationId: "c1", createdBy: 11,
  };

  it("retry exato (mesmo ator + payload, ainda minuta) ⇒ converge", () => {
    const existing = createContractWorkspace({ ...p, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(isSameContractCreate(existing, createContractWorkspace({ ...p, correlationId: "c2" }))).toBe(true);
    expect(decideContractCreateOnExisting(existing, createContractWorkspace(p))).toEqual({ kind: "converge" });
  });

  it("contrato fora de minuta (ex.: vigente) nunca converge — nem com payload idêntico", () => {
    const vigente = { ...createContractWorkspace(p), status: "vigente" as const };
    expect(decideContractCreateOnExisting(vigente, createContractWorkspace(p))).toEqual({ kind: "conflict" });
  });

  it("um campo diferente, outro ator ou ator ausente ⇒ CONFLICT", () => {
    const existing = createContractWorkspace(p);
    for (const variant of [
      { originProcess: "proc-2" }, { contractor: "Outro" }, { object: "Outro objeto" }, { value: 1234.51 },
      { term: "6 meses" }, { manager: "Gestor" }, { inspector: "Fiscal" }, { createdBy: 12 },
    ]) {
      expect(decideContractCreateOnExisting(existing, createContractWorkspace({ ...p, ...variant }))).toEqual({ kind: "conflict" });
    }
    const legacy = createContractWorkspace({ ...p, createdBy: null }); // linha anterior à coluna created_by
    expect(decideContractCreateOnExisting(legacy, createContractWorkspace({ ...p, createdBy: null }))).toEqual({ kind: "conflict" });
  });

  it("mensagem estável com token e \"(id: …)\" parseável; erros de serviço são CONFLICT", () => {
    const ws = createContractWorkspace(p);
    const msg = contractAlreadyExistsMessage(ws);
    expect(msg).toMatch(/^Já existe um contrato do Processo Licitatório com o número "CT-1" nesta organização\./);
    expect(msg).toContain(CONTRACT_ALREADY_EXISTS);
    expect(msg.match(/\(id: ([a-f0-9]+)\)/)?.[1]).toBe(ws.id);
    const err = new ContractAlreadyExistsError(ws);
    expect(err.code).toBe("CONFLICT");
    expect(err.existingId).toBe(ws.id);
    expect(new ManualContractConflictError("abc", "CT-9").message).toContain(CONTRACT_ALREADY_EXISTS);
  });
});

describe("R3 / PR-06 — freeze: caminhos de criação não usam upsert", () => {
  const src = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");

  it("legal_opinion_drafts: não existe mais escrita por upsert; edição/assinatura só com WHERE signed = 0", () => {
    const db = src("db/legalOpinionWorkspace.ts");
    expect(db).not.toMatch(/export async function insertLegalOpinionDraft\b/);
    const claim = db.slice(db.indexOf("export async function claimNewLegalOpinionDraft"), db.indexOf("export async function updateUnsignedLegalOpinionDraft"));
    expect(claim).not.toContain("onDuplicateKeyUpdate");
    expect(claim).toContain('.for("update")');
    const upd = db.slice(db.indexOf("export async function updateUnsignedLegalOpinionDraft"), db.indexOf("export async function listLegalOpinionDraftsByWorkspace"));
    expect(upd).toContain("eq(legalOpinionDraftsTable.signed, 0)");
    // versões append-only: o duplicado não sobrescreve snapshot/hash.
    const ver = db.slice(db.indexOf("export async function insertLegalOpinionVersion"), db.indexOf("export async function listLegalOpinionVersions"));
    expect(ver).not.toMatch(/onDuplicateKeyUpdate\(\{ set: \{ contentHash/);
  });

  it("contract_workspaces: os 4 fluxos de criação usam INSERT-only (persistNewContract), nunca insertContractWorkspace", () => {
    const svc = src("services/contractService.ts");
    const creation = svc.slice(svc.indexOf("export async function createFromProcurement"), svc.indexOf("// ─── Geração inteligente de minutas"));
    expect(creation).not.toContain("insertContractWorkspace(");
    expect((creation.match(/persistNewContract\(/g) ?? []).length).toBe(4);
    const db = src("db/contractWorkspace.ts");
    const fn = db.slice(db.indexOf("export async function insertNewContractWorkspace"), db.indexOf("export async function getContractWorkspace"));
    expect(fn).not.toContain("onDuplicateKeyUpdate");
  });
});
