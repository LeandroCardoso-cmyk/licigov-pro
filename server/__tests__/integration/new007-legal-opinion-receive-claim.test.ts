/**
 * NEW-007 — `openWorkspaceFromRequest` (receber = ser designado procurador) — MOCKADO.
 *
 * Antes: recebia no Engine ANTES de olhar o workspace e gravava o workspace por UPSERT — um segundo ator
 * sobrescrevia `assigned_lawyer` silenciosamente (em corrida). Agora: leitura prévia (retry converge, outro ator ⇒
 * CONFLICT), solicitação recebível validada antes de escrever, CLAIM atômico; só o vencedor escreve no Engine e
 * no histórico. Nenhuma escrita em conflito/retry. O smoke MySQL prova o mesmo com banco real e concorrência.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/institutionalRequests", () => ({
  getRequest: vi.fn(), listRequestTimeline: vi.fn(async () => []), listDocumentReferences: vi.fn(async () => []),
}));
vi.mock("../../services/institutionalRequestService", () => ({ receiveRequest: vi.fn(async () => ({})), respondRequest: vi.fn() }));
vi.mock("../../db/legalOpinionAssignment", () => ({ claimLegalOpinionWorkspaceForLawyer: vi.fn(), getLawyerAssignmentForWorkspace: vi.fn() }));
vi.mock("../../db/legalOpinionWorkspace", async (orig) => {
  const actual = await orig<typeof import("../../db/legalOpinionWorkspace")>();
  return {
    ...actual,
    getLegalOpinionWorkspace: vi.fn(), getLegalOpinionWorkspaceByRequest: vi.fn(),
    updateLegalOpinionWorkspaceStage: vi.fn(async () => true), countLegalOpinionHistory: vi.fn(async () => 0),
    insertLegalOpinionHistory: vi.fn(async () => undefined),
  };
});

import { openWorkspaceFromRequest } from "../../services/legalOpinionWorkspaceService";
import * as reqDb from "../../db/institutionalRequests";
import * as reqSvc from "../../services/institutionalRequestService";
import * as asg from "../../db/legalOpinionAssignment";
import * as wsDb from "../../db/legalOpinionWorkspace";
import { LEGAL_OPINION_ALREADY_ASSIGNED, LEGAL_OPINION_REQUEST_NOT_RECEIVABLE } from "../../services/legalOpinionAuthorityService";

const ORG = 70702;
const REQ = { id: "req-1", organizationId: ORG, destinationDomain: "parecer_juridico", sourceDomain: "processo_licitatorio", referenceProcessId: "p1", requestType: "LEGAL_OPINION_INITIAL", priority: "media", status: "PENDING" };
const wsRow = (assignedLawyer: number | null, currentStage = "INBOX") => ({
  id: "ws-1", organizationId: ORG, requestId: "req-1", sourceDomain: "processo_licitatorio", referenceProcessId: "p1", requestType: "LEGAL_OPINION_INITIAL",
  currentStage, status: "na_caixa", assignedLawyer, responsibleSector: "", priority: "media", correlationId: "c", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
});
const open = (lawyerId: number) => openWorkspaceFromRequest({ requestId: "req-1", organizationId: ORG, lawyerId, correlationId: "corr-claim" });

function expectNoWrites() {
  expect(asg.claimLegalOpinionWorkspaceForLawyer).not.toHaveBeenCalled();
  expect(reqSvc.receiveRequest).not.toHaveBeenCalled();
  expect(wsDb.updateLegalOpinionWorkspaceStage).not.toHaveBeenCalled();
  expect(wsDb.insertLegalOpinionHistory).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reqDb.getRequest).mockResolvedValue({ ...REQ } as never);
  vi.mocked(wsDb.getLegalOpinionWorkspaceByRequest).mockResolvedValue(null);
});

describe("NEW-007 — recebimento como atribuição exclusiva", () => {
  it("solicitação inexistente/de outro tenant ⇒ NOT_FOUND, sem escrita", async () => {
    vi.mocked(reqDb.getRequest).mockResolvedValue(null as never);
    await expect(open(1)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Solicitação não encontrada." });
    expectNoWrites();
  });

  it("workspace já atribuído a OUTRO ator ⇒ CONFLICT estável, sem escrita (nunca sobrescreve)", async () => {
    vi.mocked(wsDb.getLegalOpinionWorkspaceByRequest).mockResolvedValue(wsRow(7, "UNDER_ANALYSIS") as never);
    await expect(open(8)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining(LEGAL_OPINION_ALREADY_ASSIGNED) });
    expectNoWrites();
  });

  it("retry do MESMO procurador ⇒ devolve o workspace existente, sem escrita", async () => {
    vi.mocked(wsDb.getLegalOpinionWorkspaceByRequest).mockResolvedValue(wsRow(7, "UNDER_ANALYSIS") as never);
    await expect(open(7)).resolves.toMatchObject({ id: "ws-1", assignedLawyer: 7 });
    expectNoWrites();
  });

  it("solicitação fora de estado recebível ⇒ CONFLICT antes de qualquer escrita", async () => {
    vi.mocked(reqDb.getRequest).mockResolvedValue({ ...REQ, status: "COMPLETED" } as never);
    await expect(open(7)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining(LEGAL_OPINION_REQUEST_NOT_RECEIVABLE) });
    expectNoWrites();
  });

  it("perdeu a corrida do claim para OUTRO ator ⇒ CONFLICT; Engine/histórico intocados", async () => {
    vi.mocked(asg.claimLegalOpinionWorkspaceForLawyer).mockResolvedValue({ status: "assigned_to_other" });
    await expect(open(8)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining(LEGAL_OPINION_ALREADY_ASSIGNED) });
    expect(reqSvc.receiveRequest).not.toHaveBeenCalled();
    expect(wsDb.insertLegalOpinionHistory).not.toHaveBeenCalled();
  });

  it("corrida do MESMO ator (claim já dele) ⇒ devolve sem escrever no Engine/histórico", async () => {
    vi.mocked(asg.claimLegalOpinionWorkspaceForLawyer).mockResolvedValue({ status: "already_assigned_to_actor" });
    vi.mocked(wsDb.getLegalOpinionWorkspace).mockResolvedValue(wsRow(7) as never);
    await expect(open(7)).resolves.toMatchObject({ assignedLawyer: 7 });
    expect(reqSvc.receiveRequest).not.toHaveBeenCalled();
    expect(wsDb.insertLegalOpinionHistory).not.toHaveBeenCalled();
  });

  it("vencedor do claim ⇒ recebe no Engine com o PRÓPRIO ator, grava a atribuição e caminha INBOX→UNDER_ANALYSIS", async () => {
    vi.mocked(asg.claimLegalOpinionWorkspaceForLawyer).mockResolvedValue({ status: "claimed", created: true });
    vi.mocked(wsDb.getLegalOpinionWorkspace).mockResolvedValue(wsRow(7) as never);
    const ws = await open(7);
    expect(ws).toMatchObject({ currentStage: "UNDER_ANALYSIS", assignedLawyer: 7 });
    const [candidate, lawyerId, assignment] = vi.mocked(asg.claimLegalOpinionWorkspaceForLawyer).mock.calls[0];
    expect(lawyerId).toBe(7);
    expect(candidate).toMatchObject({ organizationId: ORG, requestId: "req-1", assignedLawyer: 7, currentStage: "INBOX" });
    expect(assignment).toMatchObject({ organizationId: ORG, workspaceId: candidate.id, lawyerId: 7, correlationId: "corr-claim" });
    expect(reqSvc.receiveRequest).toHaveBeenCalledWith("req-1", ORG, 7);
    const events = vi.mocked(wsDb.insertLegalOpinionHistory).mock.calls.map(c => c[0].eventType);
    expect(events).toEqual(["workspace_created", "received", "under_analysis"]);
  });
});
