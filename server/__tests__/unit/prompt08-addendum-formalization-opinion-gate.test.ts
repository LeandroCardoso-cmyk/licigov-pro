/**
 * PROMPT 08 / D-2 — auditoria (P1): o parecer vinculado à formalização de aditivo de valor/quantitativo precisa ser governado,
 * deste contrato, SOLICITADO depois da minuta do aditivo e não desfavorável. Dependências mockadas: o teste só exercita o
 * portão (que roda antes de qualquer escrita). Passado o portão, a próxima exigência (termo gerado) é a que recusa.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getContractWorkspace: vi.fn(), getContractAddendumById: vi.fn(), getRequest: vi.fn(), readLegalOpinionForConsumer: vi.fn(),
  getLatestByLineage: vi.fn(), checkIdempotency: vi.fn(), failIdempotencyKey: vi.fn(), getDb: vi.fn(),
}));
vi.mock("../../db/contractWorkspace", async (orig) => ({
  ...(await orig<typeof import("../../db/contractWorkspace")>()),
  getContractWorkspace: m.getContractWorkspace, getContractAddendumById: m.getContractAddendumById,
}));
vi.mock("../../db/institutionalRequests", async (orig) => ({ ...(await orig<typeof import("../../db/institutionalRequests")>()), getRequest: m.getRequest }));
vi.mock("../../services/institutionalRequestService", async (orig) => ({
  ...(await orig<typeof import("../../services/institutionalRequestService")>()), readLegalOpinionForConsumer: m.readLegalOpinionForConsumer,
}));
vi.mock("../../db/officialDocuments", async (orig) => ({ ...(await orig<typeof import("../../db/officialDocuments")>()), getLatestByLineage: m.getLatestByLineage }));
vi.mock("../../services/idempotencyService", () => ({ checkIdempotency: m.checkIdempotency, saveIdempotencyResult: vi.fn(), failIdempotencyKey: m.failIdempotencyKey }));
vi.mock("../../db/connection", () => ({ getDb: m.getDb }));

import { formalizeAddendum } from "../../services/contractService";

const ORG = 990801;
const ADDENDUM_AT = "2026-11-20T10:00:00.000Z";
const params = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG, contractId: "ctw-synthetic", addendumId: "add-synthetic", signedOn: "2026-11-21",
  formalizationReference: "Termo Aditivo nº 1 (sintético)", legalOpinionRequestId: "req-1", actorUserId: 7,
  correlationId: "corr-gate", idempotencyKey: "gate-key-0001", ...over,
});
const opinion = (responseStatus: string) => ({ response: { responseStatus, governedLegalOpinion: true }, institutionalResponse: null });

beforeEach(() => {
  vi.clearAllMocks();
  m.getContractWorkspace.mockResolvedValue({ id: "ctw-synthetic", organizationId: ORG, status: "vigente", contractNumber: "1/2026" });
  m.getContractAddendumById.mockResolvedValue({ id: "add-synthetic", sequence: 1, addendumType: "valor", status: "aguardando_parecer", createdAt: ADDENDUM_AT, newTerm: "", documentReference: "" });
  m.getRequest.mockResolvedValue({ id: "req-1", referenceProcessId: "ctw-synthetic", createdAt: "2026-11-20T11:00:00.000Z" });
  m.readLegalOpinionForConsumer.mockResolvedValue(opinion("favoravel"));
  m.getLatestByLineage.mockResolvedValue(null);
  m.checkIdempotency.mockResolvedValue({ status: "new" });
  m.failIdempotencyKey.mockResolvedValue(undefined);
});

const reason = async (p = params()) => {
  try { await formalizeAddendum(p); return null; } catch (e) { return e as { code?: string; message: string }; }
};

describe("Formalização de aditivo — portão do parecer jurídico", () => {
  it("parecer favorável, deste contrato e solicitado após a minuta: passa o portão (recusa seguinte = termo não gerado)", async () => {
    expect((await reason())?.message).toMatch(/ADDENDUM_TERM_REQUIRED/);
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("parecer com ressalvas também passa o portão (a conclusão é registrada no evento)", async () => {
    m.readLegalOpinionForConsumer.mockResolvedValue(opinion("com_ressalvas"));
    expect((await reason())?.message).toMatch(/ADDENDUM_TERM_REQUIRED/);
  });

  it("parecer DESFAVORÁVEL ⇒ PRECONDITION_FAILED, nada gravado", async () => {
    m.readLegalOpinionForConsumer.mockResolvedValue(opinion("desfavoravel"));
    const e = await reason();
    expect(e).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(e?.message).toMatch(/ADDENDUM_LEGAL_OPINION_UNFAVORABLE/);
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("parecer solicitado ANTES da minuta do aditivo ⇒ não examinou este aditivo: recusa", async () => {
    m.getRequest.mockResolvedValue({ id: "req-1", referenceProcessId: "ctw-synthetic", createdAt: "2026-11-19T09:00:00.000Z" });
    const e = await reason();
    expect(e).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(e?.message).toMatch(/ADDENDUM_LEGAL_OPINION_REQUIRED.*antes da minuta/);
  });

  it("parecer de outro contrato ou sem origem governada ⇒ recusa", async () => {
    m.getRequest.mockResolvedValue({ id: "req-1", referenceProcessId: "ctw-outro", createdAt: "2026-11-20T11:00:00.000Z" });
    expect((await reason())?.message).toMatch(/ADDENDUM_LEGAL_OPINION_REQUIRED/);
    m.getRequest.mockResolvedValue({ id: "req-1", referenceProcessId: "ctw-synthetic", createdAt: "2026-11-20T11:00:00.000Z" });
    m.readLegalOpinionForConsumer.mockResolvedValue({ response: null, institutionalResponse: { responseStatus: "favoravel" } });
    expect((await reason())?.message).toMatch(/ADDENDUM_LEGAL_OPINION_REQUIRED/);
  });
});
