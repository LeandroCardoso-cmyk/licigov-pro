/**
 * PROMPT 08 / D-2 + PROMPT 09 / Frente A — portão do parecer na formalização de aditivo de valor/quantitativo: governado,
 * deste contrato, SOLICITADO PARA ESTE ADITIVO (`referenceDocumentId`) e para a VERSÃO VIGENTE do termo; favorável, ou com
 * ressalvas + registro do atendimento. Dependências mockadas: o portão roda antes de qualquer escrita; passado o portão, o
 * próximo passo (abrir a transação) falha de propósito (banco indisponível no mock) — prova de que o portão foi superado.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getContractWorkspace: vi.fn(), getContractAddendumById: vi.fn(), listContractAddenda: vi.fn(), getRequest: vi.fn(), readLegalOpinionForConsumer: vi.fn(),
  getLatestByLineage: vi.fn(), checkIdempotency: vi.fn(), failIdempotencyKey: vi.fn(), getDb: vi.fn(),
}));
vi.mock("../../db/contractWorkspace", async (orig) => ({
  ...(await orig<typeof import("../../db/contractWorkspace")>()),
  getContractWorkspace: m.getContractWorkspace, getContractAddendumById: m.getContractAddendumById, listContractAddenda: m.listContractAddenda,
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
const TERM = { id: "term-synthetic", version: 2 };
const params = (over: Record<string, unknown> = {}) => ({
  organizationId: ORG, contractId: "ctw-synthetic", addendumId: "add-synthetic", signedOn: "2026-11-21",
  formalizationReference: "Termo Aditivo nº 1 (sintético)", legalOpinionRequestId: "req-1", actorUserId: 7,
  correlationId: "corr-gate", idempotencyKey: "gate-key-0001", ...over,
});
const opinion = (responseStatus: string, documents = [{ documentId: TERM.id, version: TERM.version }]) => ({
  response: { responseStatus, governedLegalOpinion: true }, institutionalResponse: null, documents,
});
const PASSED = /Banco de dados indisponível/;

beforeEach(() => {
  vi.clearAllMocks();
  m.getContractWorkspace.mockResolvedValue({ id: "ctw-synthetic", organizationId: ORG, status: "vigente", contractNumber: "1/2026" });
  m.getContractAddendumById.mockResolvedValue({ id: "add-synthetic", sequence: 1, addendumType: "valor", status: "aguardando_parecer", createdAt: "2026-11-20T10:00:00.000Z", newTerm: "", documentReference: "" });
  m.getRequest.mockResolvedValue({ id: "req-1", referenceProcessId: "ctw-synthetic", referenceDocumentId: "add-synthetic", createdAt: "2026-11-20T11:00:00.000Z" });
  m.readLegalOpinionForConsumer.mockResolvedValue(opinion("favoravel"));
  m.getLatestByLineage.mockResolvedValue(TERM);
  m.listContractAddenda.mockResolvedValue([]);
  m.checkIdempotency.mockResolvedValue({ status: "new" });
  m.failIdempotencyKey.mockResolvedValue(undefined);
  m.getDb.mockResolvedValue(null);
});

const reason = async (p = params()) => {
  try { await formalizeAddendum(p); return null; } catch (e) { return e as { code?: string; message: string }; }
};

describe("Formalização de aditivo — portão do parecer jurídico", () => {
  it("parecer favorável, vinculado ao aditivo e à versão vigente do termo: passa o portão", async () => {
    expect((await reason())?.message).toMatch(PASSED);
  });

  it("parecer com ressalvas: exige o registro do atendimento (nunca presumido); com o registro, passa", async () => {
    m.readLegalOpinionForConsumer.mockResolvedValue(opinion("com_ressalvas"));
    expect((await reason())?.message).toMatch(/ADDENDUM_OPINION_RESERVATIONS_UNADDRESSED/);
    expect((await reason(params({ reservationsAddressed: "Cláusula ajustada (sintético)." })))?.message).toMatch(PASSED);
  });

  it("desfavorável ou conclusão fora da allow-list ⇒ recusa, nada gravado", async () => {
    for (const c of ["desfavoravel", "informativo"]) {
      m.readLegalOpinionForConsumer.mockResolvedValue(opinion(c));
      const e = await reason();
      expect(e).toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(e?.message).toMatch(/ADDENDUM_LEGAL_OPINION_UNFAVORABLE/);
    }
    expect(m.getDb).not.toHaveBeenCalled();
  });

  it("parecer do contrato SEM vínculo ao aditivo (ou de outro aditivo) ⇒ recusa — data posterior não basta", async () => {
    for (const ref of ["", "add-outro"]) {
      m.getRequest.mockResolvedValue({ id: "req-1", referenceProcessId: "ctw-synthetic", referenceDocumentId: ref, createdAt: "2026-11-25T11:00:00.000Z" });
      expect((await reason())?.message).toMatch(/ADDENDUM_LEGAL_OPINION_NOT_BOUND/);
    }
  });

  it("parecer sobre OUTRA versão do termo ⇒ recusa", async () => {
    m.readLegalOpinionForConsumer.mockResolvedValue(opinion("favoravel", [{ documentId: TERM.id, version: 1 }]));
    expect((await reason())?.message).toMatch(/ADDENDUM_LEGAL_OPINION_STALE_TERM/);
  });

  it("parecer de outro contrato ou sem origem governada ⇒ recusa", async () => {
    m.getRequest.mockResolvedValue({ id: "req-1", referenceProcessId: "ctw-outro", referenceDocumentId: "add-synthetic", createdAt: "2026-11-20T11:00:00.000Z" });
    expect((await reason())?.message).toMatch(/ADDENDUM_LEGAL_OPINION_REQUIRED/);
    m.getRequest.mockResolvedValue({ id: "req-1", referenceProcessId: "ctw-synthetic", referenceDocumentId: "add-synthetic", createdAt: "2026-11-20T11:00:00.000Z" });
    m.readLegalOpinionForConsumer.mockResolvedValue({ response: null, institutionalResponse: { responseStatus: "favoravel" }, documents: [] });
    expect((await reason())?.message).toMatch(/ADDENDUM_LEGAL_OPINION_REQUIRED/);
  });

  it("sem termo gerado ⇒ ADDENDUM_TERM_REQUIRED antes do parecer", async () => {
    m.getLatestByLineage.mockResolvedValue(null);
    expect((await reason())?.message).toMatch(/ADDENDUM_TERM_REQUIRED/);
  });
});
