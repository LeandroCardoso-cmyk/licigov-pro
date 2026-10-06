/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SW-C1 — Instrumentos contratuais (SEM-084 sequência atômica, SEM-062 gestor/fiscal por apostilamento,
 * SEM-040 linhagem própria por instrumento). Contrato SEM banco (mocks do repositório; o comportamento real contra
 * MySQL está em `sem084-sem062-sem040-contract-instruments-mysql-smoke.test.ts`).
 *
 * SEM-084: a transação TRAVA a linha do contrato ANTES de ler o status e alocar a sequência; nenhuma contagem fora dela;
 *          o status avaliado vale SOB o lock; a IA/minuta roda DEPOIS (fora da transação).
 * SEM-062: apostilamento `gestor`/`fiscal` aplica `manager`/`inspector` na MESMA sentença do CAS de status, com evento
 *          "antes → depois" e ator humano; nome obrigatório e só no campo do tipo; revisão opcional (CAS) do cliente.
 * SEM-040: o termo do instrumento é gerado com `instrumentId` (linhagem própria) e metadados instrumentId/instrumentKind/sequence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const cw = vi.hoisted(() => ({
  status: "vigente" as string,
  lockStatus: null as string | null,
  lockRevision: "2026-03-01T10:00:00.000Z",
  manager: "Gestor Atual",
  inspector: "Fiscal Atual",
  casResult: true,
  nextSeq: 1,
  getContractWorkspace: vi.fn(),
  lock: vi.fn(),
  nextAddendum: vi.fn(),
  nextApostille: vi.fn(),
  insertAddendum: vi.fn(async (a: unknown) => a),
  insertApostille: vi.fn(async (a: unknown) => a),
  cas: vi.fn(),
  insertDoc: vi.fn(async (d: unknown) => d),
  orchestrate: vi.fn(async () => ({ consolidated: { suggestions: ["s"], legalBasis: ["Lei 14.133/2021"], confidence: 0.5, summary: "r" }, selectedCopilots: ["contratos"] })),
  generateOfficial: vi.fn(async () => ({ id: "off-1" })),
  recordEvent: vi.fn(async () => undefined),
  transaction: vi.fn(),
}));
vi.mock("../../db/contractWorkspace", async (orig) => ({
  ...(await orig<typeof import("../../db/contractWorkspace")>()),
  getContractWorkspace: cw.getContractWorkspace,
  lockContractWorkspaceForInstrument: cw.lock,
  nextAddendumSequenceUnderLock: cw.nextAddendum,
  nextApostilleSequenceUnderLock: cw.nextApostille,
  insertContractAddendum: cw.insertAddendum,
  insertContractApostille: cw.insertApostille,
  compareAndSetContractWorkspaceStatus: cw.cas,
  insertContractWsDocument: cw.insertDoc,
  listContractAddenda: vi.fn(async () => cw.insertAddendum.mock.calls.map((c) => c[0])),
  listContractApostilles: vi.fn(async () => cw.insertApostille.mock.calls.map((c) => c[0])),
  // SEM084-B (reescrito): o comando procura o instrumento da MESMA tentativa lógica (id derivado da chave) — aqui, nenhum.
  getContractAddendumById: vi.fn(async () => null),
  getContractApostilleById: vi.fn(async () => null),
}));
// SEM084-B (reescrito): idempotência do comando e retomada do termo têm smokes MySQL próprios; aqui são neutras.
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn(async () => ({ status: "new" })), saveIdempotencyResult: vi.fn(async () => undefined), failIdempotencyKey: vi.fn(async () => undefined),
}));
vi.mock("../../db/officialDocuments", async (orig) => ({ ...(await orig<typeof import("../../db/officialDocuments")>()), getLatestByLineage: vi.fn(async () => null) }));
vi.mock("../../services/workspaceOrchestratorService", () => ({ orchestrateMultiCopilot: cw.orchestrate }));
vi.mock("../../services/documentEngineService", () => ({ generateOfficialDocument: cw.generateOfficial }));
vi.mock("../../db/procurement", async (orig) => ({ ...(await orig<typeof import("../../db/procurement")>()), recordProcessEvent: cw.recordEvent }));
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => ({ transaction: cw.transaction })) }));

import {
  createContractWorkspace, ContractRevisionConflictError, ContractStatusTransitionError, ContractApostilleAssignmentInvalidError,
  planApostilleAssignment, CONTRACT_APOSTILLE_ASSIGNMENT_INVALID,
} from "../../domain/contractWorkspace";
import { createAddendum, createApostille, generateContractDocument } from "../../services/contractService";
import { computeLineageId } from "../../domain/officialDocument";

// SEM084-B — o comando de criação de instrumento exige uma chave de idempotência (uma por tentativa lógica).
let cmdKeySeq = 0;
const cmdKey = () => `cmd-${Date.now().toString(36)}-${++cmdKeySeq}`;

const TX = { __tx: true };
const ORG = 7;
const row = (status: string) => ({
  ...createContractWorkspace({ organizationId: ORG, originType: "avulso", contractNumber: "CT-SWC1", correlationId: "c", manager: cw.manager, inspector: cw.inspector }),
  status, updatedAt: cw.lockRevision,
});
const CID = row("vigente").id;
const base = { organizationId: ORG, contractId: "c1", correlationId: "corr-swc1", actorUserId: 42 } as const;
const orderOf = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0];

beforeEach(() => {
  vi.clearAllMocks();
  cw.status = "vigente"; cw.lockStatus = null; cw.casResult = true; cw.nextSeq = 1;
  cw.manager = "Gestor Atual"; cw.inspector = "Fiscal Atual";
  cw.getContractWorkspace.mockImplementation(async () => row(cw.status));
  cw.lock.mockImplementation(async () => row(cw.lockStatus ?? cw.status));
  cw.nextAddendum.mockImplementation(async () => cw.nextSeq);
  cw.nextApostille.mockImplementation(async () => cw.nextSeq);
  cw.cas.mockImplementation(async () => cw.casResult);
  cw.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX));
});

describe("SEM-084 — sequência alocada DENTRO da transação, sob o lock da linha do contrato", () => {
  it("ordem: lock → alocação → INSERT → CAS → evento, tudo no MESMO tx; IA/minuta só DEPOIS", async () => {
    await createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "prazo", justification: "j" });
    expect(cw.lock).toHaveBeenCalledWith(CID, ORG, TX);
    expect(cw.nextAddendum).toHaveBeenCalledWith(CID, ORG, TX);
    expect(cw.insertAddendum).toHaveBeenCalledWith(expect.anything(), TX, { failOnDuplicate: true });
    expect(cw.cas).toHaveBeenCalledWith(expect.objectContaining({ id: CID, orgId: ORG }), TX);
    expect(cw.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "change" }), TX);
    const o = [cw.lock, cw.nextAddendum, cw.insertAddendum, cw.cas, cw.recordEvent, cw.orchestrate].map(orderOf);
    expect([...o].sort((a, b) => a - b)).toEqual(o); // estritamente nessa ordem
    expect(cw.transaction).toHaveBeenCalledTimes(1);
  });

  // SEM084-B (reescrito): o id do instrumento é derivado da chave do comando (uma por tentativa lógica), não da sequência.
  it("a sequência do instrumento é a ALOCADA sob o lock (não `count+1` externo); id determinístico por comando (chave)", async () => {
    cw.nextSeq = 5;
    const a = await createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "prazo", justification: "j" });
    expect(a.addendum?.sequence).toBe(5);
    cw.nextSeq = 6;
    const b = await createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "prazo", justification: "j2" });
    expect(b.addendum?.sequence).toBe(6);
    expect(b.addendum?.id).not.toBe(a.addendum?.id);
    cw.nextSeq = 3;
    const p = await createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "reajuste", newValue: 10 });
    expect(p?.sequence).toBe(3);
    expect(cw.nextApostille).toHaveBeenCalledWith(CID, ORG, TX);
  });

  it("status REAL lido sob o lock é o que vale: pré-checagem 'vigente', lock 'rescindido' ⇒ recusa da máquina; nada gravado", async () => {
    cw.status = "vigente"; cw.lockStatus = "rescindido";
    await expect(createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "prazo", justification: "j" })).rejects.toBeInstanceOf(ContractStatusTransitionError);
    await expect(createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "reajuste", newValue: 1 })).rejects.toBeInstanceOf(ContractStatusTransitionError);
    for (const fn of [cw.nextAddendum, cw.nextApostille, cw.insertAddendum, cw.insertApostille, cw.cas, cw.recordEvent, cw.orchestrate, cw.generateOfficial]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("o CAS parte do status lido SOB o lock e da revisão lida sob o lock; revisão nova estritamente posterior", async () => {
    cw.status = "vigente"; cw.lockStatus = "apostilado";
    await createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "prazo", justification: "j" });
    const arg = cw.cas.mock.calls[0][0];
    expect(arg).toMatchObject({ fromStatus: "apostilado", toStatus: "aditado", expectedUpdatedAt: cw.lockRevision });
    expect(Date.parse(arg.updatedAt)).toBeGreaterThan(Date.parse(cw.lockRevision));
  });

  it("contrato inexistente sob o lock (removido/outro tenant) ⇒ erro, sem alocar nem gravar", async () => {
    cw.lock.mockResolvedValueOnce(null);
    await expect(createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "prazo", justification: "j" })).rejects.toThrow("Contrato não encontrado");
    expect(cw.nextAddendum).not.toHaveBeenCalled();
    expect(cw.insertAddendum).not.toHaveBeenCalled();
    expect(cw.recordEvent).not.toHaveBeenCalled();
  });

  it("limites do art. 125 NÃO são impostos (J-4 bloqueado): aditivo de valor enorme segue registrado aguardando parecer", async () => {
    const r = await createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "valor", justification: "acréscimo", newValue: 9_999_999_999 });
    expect(r.requiresLegalOpinion).toBe(true);
    expect(r.addendum?.status).toBe("aguardando_parecer");
  });

  it("evento do instrumento tem o ATOR HUMANO (user:<id>), nunca 'sistema'/multi_copilot, e o correlationId", async () => {
    await createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "prazo", justification: "j" });
    expect(cw.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ actor: "user:42", correlationId: "corr-swc1", refId: expect.any(String) }), TX);
    vi.clearAllMocks(); cw.status = "vigente";
    cw.getContractWorkspace.mockImplementation(async () => row(cw.status)); cw.lock.mockImplementation(async () => row(cw.status));
    cw.nextApostille.mockImplementation(async () => 1); cw.cas.mockImplementation(async () => true);
    cw.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX));
    // SEM084-B (reescrito): o comando exige o ator humano (a chave de idempotência é escopada por usuário) — sem ele,
    // recusa ANTES de qualquer efeito (nenhuma transação, nenhum evento "sistema").
    await expect(createApostille({ idempotencyKey: cmdKey(),  ...base, actorUserId: undefined as unknown as number, kind: "reajuste", newValue: 1 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("INSTRUMENT_COMMAND_ACTOR_REQUIRED") });
    expect(cw.transaction).not.toHaveBeenCalled();
    expect(cw.recordEvent).not.toHaveBeenCalled();
  });
});

describe("SEM-062 — apostilamento de gestor/fiscal APLICA a designação ao contrato, atomicamente", () => {
  it("gestor: CAS (mesma sentença) grava manager; evento 'gestor: antes → depois'; fiscal/valor intactos", async () => {
    const ap = await createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "gestor", description: "Troca", newManager: "  Maria Nova  " });
    expect(cw.cas).toHaveBeenCalledWith(expect.objectContaining({
      fromStatus: "vigente", toStatus: "apostilado", assignment: { manager: "Maria Nova" }, expectedUpdatedAt: cw.lockRevision,
    }), TX);
    expect(cw.cas.mock.calls[0][0].assignment).not.toHaveProperty("inspector");
    const ev = cw.recordEvent.mock.calls[0][0] as { summary: string; actor: string };
    expect(ev.summary).toContain('gestor: "Gestor Atual" → "Maria Nova"');
    expect(ev.actor).toBe("user:42");
    expect(ap?.newManager).toBe("Maria Nova");
    expect(ap?.newInspector).toBe("");
    expect(cw.generateOfficial).toHaveBeenCalledTimes(1); // minuta depois, fora da transação
    expect(orderOf(cw.cas)).toBeLessThan(orderOf(cw.orchestrate));
  });

  it("fiscal: grava inspector; manager intacto", async () => {
    await createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "fiscal", newInspector: "João Novo" });
    const arg = cw.cas.mock.calls[0][0];
    expect(arg.assignment).toEqual({ inspector: "João Novo" });
    expect((cw.recordEvent.mock.calls[0][0] as { summary: string }).summary).toContain('fiscal: "Fiscal Atual" → "João Novo"');
  });

  it("'antes' é o valor lido SOB O LOCK (não o da pré-leitura) e 'não designado' quando vazio", async () => {
    cw.lock.mockImplementation(async () => ({ ...row("vigente"), manager: "" }));
    await createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "gestor", newManager: "Primeira Designação" });
    expect((cw.recordEvent.mock.calls[0][0] as { summary: string }).summary).toContain('gestor: (não designado) → "Primeira Designação"');
  });

  it("reajuste/legal NÃO tocam manager/inspector (sem 'assignment' no CAS)", async () => {
    for (const kind of ["reajuste", "legal"] as const) {
      vi.clearAllMocks(); cw.cas.mockImplementation(async () => true);
      cw.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(TX));
      cw.getContractWorkspace.mockImplementation(async () => row("vigente")); cw.lock.mockImplementation(async () => row("vigente")); cw.nextApostille.mockImplementation(async () => 1);
      await createApostille({ idempotencyKey: cmdKey(),  ...base, kind, newValue: 5 });
      expect(cw.cas.mock.calls[0][0]).not.toHaveProperty("assignment");
    }
  });

  it("recusas ANTES de qualquer efeito (sem tx, lock, escrita, IA, evento): nome ausente, nome em branco, campo alheio", async () => {
    const bad: Array<Parameters<typeof createApostille>[0]> = [
      { ...base, kind: "gestor" },
      { ...base, kind: "gestor", newManager: "   " },
      { ...base, kind: "fiscal" },
      { ...base, kind: "gestor", newManager: "Maria", newInspector: "João" },
      { ...base, kind: "fiscal", newInspector: "João", newManager: "Maria" },
      { ...base, kind: "reajuste", newValue: 1, newManager: "Maria" },
      { ...base, kind: "legal", newInspector: "João" },
    ];
    for (const p of bad) {
      await expect(createApostille({ ...p, idempotencyKey: cmdKey() }), JSON.stringify(p)).rejects.toBeInstanceOf(ContractApostilleAssignmentInvalidError);
    }
    for (const fn of [cw.transaction, cw.lock, cw.nextApostille, cw.insertApostille, cw.cas, cw.recordEvent, cw.orchestrate, cw.generateOfficial]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("contrato recusante (minuta/encerrado) ⇒ recusa da MÁQUINA primeiro (mensagem preservada), mesmo com campos inválidos", async () => {
    cw.status = "minuta";
    await expect(createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "reajuste", newValue: 1, newManager: "Maria", newInspector: "João" })).rejects.toBeInstanceOf(ContractStatusTransitionError);
    expect(cw.transaction).not.toHaveBeenCalled();
  });

  it("revisão do cliente divergente da lida sob o lock ⇒ ContractRevisionConflictError; nada gravado", async () => {
    await expect(createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "gestor", newManager: "Maria", expectedUpdatedAt: "2026-02-01T00:00:00.000Z" }))
      .rejects.toBeInstanceOf(ContractRevisionConflictError);
    for (const fn of [cw.nextApostille, cw.insertApostille, cw.cas, cw.recordEvent, cw.orchestrate]) expect(fn).not.toHaveBeenCalled();
    // revisão igual (mesmo instante) passa
    await createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "gestor", newManager: "Maria", expectedUpdatedAt: cw.lockRevision });
    expect(cw.cas).toHaveBeenCalledTimes(1);
  });

  it("CAS não casa ⇒ rollback sem evento e sem minuta (designação nunca fica pela metade)", async () => {
    cw.casResult = false;
    await expect(createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "gestor", newManager: "Maria" })).rejects.toBeTruthy();
    expect(cw.recordEvent).not.toHaveBeenCalled();
    expect(cw.orchestrate).not.toHaveBeenCalled();
    expect(cw.generateOfficial).not.toHaveBeenCalled();
  });

  it("domínio puro: planApostilleAssignment", () => {
    const cur = { manager: "A", inspector: "B" };
    expect(planApostilleAssignment(cur, "gestor", { newManager: " X " })).toEqual({ field: "manager", before: "A", after: "X" });
    expect(planApostilleAssignment(cur, "fiscal", { newInspector: "Y" })).toEqual({ field: "inspector", before: "B", after: "Y" });
    expect(planApostilleAssignment(cur, "reajuste", {})).toBeNull();
    expect(() => planApostilleAssignment(cur, "gestor", {})).toThrow(CONTRACT_APOSTILLE_ASSIGNMENT_INVALID);
    expect(() => planApostilleAssignment(cur, "legal", { newManager: "X" })).toThrow(CONTRACT_APOSTILLE_ASSIGNMENT_INVALID);
  });
});

describe("SEM-040 — o termo do instrumento nasce em linhagem PRÓPRIA, com metadados do instrumento", () => {
  async function gen(kind: "aditivo" | "apostilamento", refId: string) {
    cw.generateOfficial.mockClear();
    await generateContractDocument({ organizationId: ORG, contractId: "c1", kind, refId, actorUserId: 42, correlationId: "corr-gen" });
    return cw.generateOfficial.mock.calls[0]![0] as Record<string, any>;
  }

  it("aditivo: instrumentId na identidade da linhagem; metadados instrumentId/instrumentKind/sequence/lineageScope; título com o nº", async () => {
    cw.nextSeq = 2;
    const { addendum } = await createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "prazo", justification: "j" });
    const params = cw.generateOfficial.mock.calls[0]![0] as Record<string, any>;
    expect(params.instrumentId).toBe(addendum!.id);
    expect(params.metadata).toMatchObject({ instrumentId: addendum!.id, instrumentKind: "aditivo", sequence: 2, lineageScope: "instrument" });
    expect(params.title).toContain("nº 2");
    expect(params.origin).toBe(CID); // origem segue o contrato (listagem por origem continua válida)
    expect(params.documentType).toBe("aditivo");
  });

  it("apostilamento: idem (kind apostilamento)", async () => {
    cw.nextSeq = 4;
    const ap = await createApostille({ idempotencyKey: cmdKey(),  ...base, kind: "reajuste", newValue: 1 });
    const params = cw.generateOfficial.mock.calls[0]![0] as Record<string, any>;
    expect(params.instrumentId).toBe(ap!.id);
    expect(params.metadata).toMatchObject({ instrumentKind: "apostilamento", sequence: 4, lineageScope: "instrument" });
    expect(params.title).toContain("nº 4");
  });

  it("re-gerar o MESMO instrumento mantém a MESMA linhagem (versões do próprio instrumento); contrato/rescisão não têm instrumentId", async () => {
    const { addendum } = await createAddendum({ idempotencyKey: cmdKey(),  ...base, addendumType: "prazo", justification: "j" });
    const again = await gen("aditivo", addendum!.id);
    expect(again.instrumentId).toBe(addendum!.id);
    await generateContractDocument({ organizationId: ORG, contractId: "c1", kind: "contrato", actorUserId: 42, correlationId: "c" });
    const contract = cw.generateOfficial.mock.calls.at(-1)![0] as Record<string, any>;
    expect(contract.instrumentId).toBeUndefined();
    expect(contract.metadata.lineageScope).toBeUndefined();
  });

  it("computeLineageId: instrumentos diferentes ⇒ linhagens diferentes; sem instrumentId ⇒ fórmula ANTERIOR (legado legível)", () => {
    const k = { tenantId: ORG, businessDomain: "contratos", documentType: "aditivo", origin: "c1" };
    const legacy = computeLineageId(k);
    const a1 = computeLineageId({ ...k, instrumentId: "aaa" });
    const a2 = computeLineageId({ ...k, instrumentId: "bbb" });
    expect(new Set([legacy, a1, a2]).size).toBe(3);
    expect(computeLineageId({ ...k, instrumentId: undefined })).toBe(legacy);
    expect(computeLineageId({ ...k, instrumentId: "" })).toBe(legacy);
    expect(computeLineageId({ ...k, instrumentId: "aaa" })).toBe(a1); // determinístico
    expect(computeLineageId({ ...k, tenantId: ORG + 1, instrumentId: "aaa" })).not.toBe(a1); // tenant na identidade
    expect(legacy).toBe(computeLineageId({ tenantId: ORG, businessDomain: "contratos", documentType: "aditivo", origin: "c1" }));
  });
});
