/**
 * R3 / PR-05 — contrato "Create ≠ Reset" dos criadores canônicos de processo (SEM-002, SEM-003).
 *
 *  - regra PURA de "mesma criação" (`procurementCreateMismatches` / `directProcurementCreateMismatches`);
 *  - token e mensagens pt-BR ESTÁVEIS (congelados — o cliente exibe `error.message`);
 *  - guarda estática: os caminhos de CRIAÇÃO não usam upsert (`onDuplicateKeyUpdate`) e traduzem ER_DUP_ENTRY
 *    em `ProcessAlreadyExistsError`; os routers resolvem o conflito sem escrever.
 * O comportamento real (MySQL, router, concorrência, cross-tenant) está em
 * `integration/create-not-reset-processes-mysql-smoke.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  PROCESS_ALREADY_EXISTS, PROCUREMENT_PROCESS_ALREADY_EXISTS_MESSAGE, DIRECT_PROCUREMENT_ALREADY_EXISTS_MESSAGE,
  ProcessAlreadyExistsError, procurementCreateMismatches, directProcurementCreateMismatches,
} from "../../domain/processCreateContract";
import { isDuplicateKeyError } from "../../db/procurement";

const src = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const fnBody = (code: string, signature: string): string => {
  const start = code.indexOf(signature);
  expect(start, signature).toBeGreaterThanOrEqual(0);
  const next = code.indexOf("\nexport ", start + signature.length);
  return code.slice(start, next === -1 ? undefined : next);
};

describe("R3 / PR-05 — token e mensagens estáveis", () => {
  it("token PROCESS_ALREADY_EXISTS e mensagens pt-BR congeladas (sem dados do registro existente)", () => {
    expect(PROCESS_ALREADY_EXISTS).toBe("PROCESS_ALREADY_EXISTS");
    expect(PROCUREMENT_PROCESS_ALREADY_EXISTS_MESSAGE).toBe(
      "Já existe um processo licitatório com este número nesta organização. O processo existente não foi alterado: " +
      "abra-o pela lista de processos ou informe outro número (PROCESS_ALREADY_EXISTS).");
    expect(DIRECT_PROCUREMENT_ALREADY_EXISTS_MESSAGE).toBe(
      "Já existe uma contratação direta com este número nesta organização. O processo existente não foi alterado: " +
      "abra-o pela lista de processos ou informe outro número (PROCESS_ALREADY_EXISTS).");
  });

  it("ProcessAlreadyExistsError carrega só o id (nada de payload) e é identificável", () => {
    const e = new ProcessAlreadyExistsError("abc123");
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("ProcessAlreadyExistsError");
    expect(e.processId).toBe("abc123");
    expect(e.message).toContain(PROCESS_ALREADY_EXISTS);
  });

  it("isDuplicateKeyError reconhece ER_DUP_ENTRY/1062 direto ou encapsulado (cause) e nada mais", () => {
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY" })).toBe(true);
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
    expect(isDuplicateKeyError(Object.assign(new Error("Failed query"), { cause: { code: "ER_DUP_ENTRY", errno: 1062 } }))).toBe(true);
    expect(isDuplicateKeyError(new Error("Incorrect datetime value"))).toBe(false);
    expect(isDuplicateKeyError({ code: "ER_LOCK_DEADLOCK", errno: 1213 })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
  });
});

describe("R3 / PR-05 — regra pura de 'mesma criação' (Processo Licitatório)", () => {
  const existing = {
    responsibleUser: 7, object: "Aquisição de notebooks", startOption: "criar_dfd", modality: "",
    createRequestingUnits: ["Secretaria de Educação"],
  };
  const req = { actorUserId: 7, object: "Aquisição de notebooks", startOption: "criar_dfd", requestingUnit: "Secretaria de Educação" };

  it("mesmo ator + payload idêntico ⇒ [] (converge)", () => {
    expect(procurementCreateMismatches(existing, req)).toEqual([]);
    // única equivalência: opcional ausente ≡ "" (a mesma regra de gravação de createProcurementWorkspace)
    expect(procurementCreateMismatches(existing, { ...req, modality: undefined })).toEqual([]);
    expect(procurementCreateMismatches({ ...existing, createRequestingUnits: [] }, { ...req, requestingUnit: null })).toEqual([]);
  });

  it("nenhuma normalização nova: espaço/caixa diferentes NÃO convergem (fail-closed ⇒ CONFLICT)", () => {
    expect(procurementCreateMismatches(existing, { ...req, object: "Aquisição de notebooks " })).toEqual(["object"]);
    expect(procurementCreateMismatches(existing, { ...req, object: "aquisição de notebooks" })).toEqual(["object"]);
    expect(procurementCreateMismatches(existing, { ...req, modality: " " })).toEqual(["modality"]);
  });

  it("cada divergência é nomeada (sem valores) ⇒ CONFLICT", () => {
    expect(procurementCreateMismatches(existing, { ...req, actorUserId: 8 })).toEqual(["actor"]);
    expect(procurementCreateMismatches(existing, { ...req, object: "Outro" })).toEqual(["object"]);
    expect(procurementCreateMismatches(existing, { ...req, startOption: "iniciar_etp" })).toEqual(["startOption"]);
    expect(procurementCreateMismatches(existing, { ...req, modality: "pregao" })).toEqual(["modality"]);
    expect(procurementCreateMismatches(existing, { ...req, requestingUnit: "Secretaria de Saúde" })).toEqual(["requestingUnit"]);
    expect(procurementCreateMismatches(existing, { ...req, requestingUnit: null })).toEqual(["requestingUnit"]);
    expect(procurementCreateMismatches({ ...existing, createRequestingUnits: [] }, req)).toEqual(["requestingUnit"]);
  });

  it("resíduo do upsert pré-R3 (dois valores de criação distintos) ⇒ divergência (fail-closed)", () => {
    const polluted = { ...existing, createRequestingUnits: ["Secretaria de Educação", "Secretaria de Saúde"] };
    expect(procurementCreateMismatches(polluted, req)).toEqual(["requestingUnit"]);
    // duplicata do MESMO valor não é ambiguidade
    expect(procurementCreateMismatches({ ...existing, createRequestingUnits: ["Secretaria de Educação", "Secretaria de Educação"] }, req)).toEqual([]);
  });

  it("etapa/status/modalidade atuais NÃO entram como 'payload' — mas modalidade alterada depois impede convergência", () => {
    expect(procurementCreateMismatches({ ...existing, modality: "pregao" }, req)).toEqual(["modality"]);
  });
});

describe("R3 / PR-05 — regra pura de 'mesma criação' (Contratação Direta)", () => {
  const existing = { responsibleUser: 7, object: "Manutenção", procurementType: "dispensa", startOption: "criar_dfd", legalBasis: "" };
  const req = { actorUserId: 7, object: "Manutenção", procurementType: "dispensa", startOption: "criar_dfd" };

  it("mesmo ator + payload idêntico ⇒ [] (fundamento ausente ≡ vazio, como createDirectProcurementWorkspace grava)", () => {
    expect(directProcurementCreateMismatches(existing, req)).toEqual([]);
    expect(directProcurementCreateMismatches(existing, { ...req, legalBasis: undefined })).toEqual([]);
    expect(directProcurementCreateMismatches({ ...existing, legalBasis: "Art. 75, II" }, { ...req, legalBasis: "Art. 75, II" })).toEqual([]);
  });

  it("nenhuma normalização nova: espaço diferente NÃO converge (fail-closed ⇒ CONFLICT)", () => {
    expect(directProcurementCreateMismatches(existing, { ...req, object: " Manutenção" })).toEqual(["object"]);
    expect(directProcurementCreateMismatches({ ...existing, legalBasis: "Art. 75, II" }, { ...req, legalBasis: "Art. 75, II " })).toEqual(["legalBasis"]);
  });

  it("cada divergência é nomeada ⇒ CONFLICT", () => {
    expect(directProcurementCreateMismatches(existing, { ...req, actorUserId: 9 })).toEqual(["actor"]);
    expect(directProcurementCreateMismatches(existing, { ...req, object: "Outro" })).toEqual(["object"]);
    expect(directProcurementCreateMismatches(existing, { ...req, procurementType: "inexigibilidade" })).toEqual(["procurementType"]);
    expect(directProcurementCreateMismatches(existing, { ...req, startOption: "sem_dfd" })).toEqual(["startOption"]);
    expect(directProcurementCreateMismatches(existing, { ...req, legalBasis: "Art. 74, I" })).toEqual(["legalBasis"]);
    // fundamento escolhido DEPOIS da criação ⇒ retry tardio sem fundamento não converge (fail-closed, sem escrita)
    expect(directProcurementCreateMismatches({ ...existing, legalBasis: "Art. 75, II" }, req)).toEqual(["legalBasis"]);
  });
});

describe("R3 / PR-05 — guarda estática: criação nunca é upsert", () => {
  const proc = src("server/db/procurement.ts");
  const direct = src("server/db/directProcurement.ts");

  it("insertProcess e createProcessWithInitialEvent: INSERT puro, colisão ⇒ ProcessAlreadyExistsError", () => {
    const insert = fnBody(proc, "export async function insertProcess(");
    expect(insert).not.toMatch(/onDuplicateKeyUpdate/);
    expect(insert).toMatch(/isDuplicateKeyError\(err\)\) throw new ProcessAlreadyExistsError\(p\.id\)/);
    const create = fnBody(proc, "export async function createProcessWithInitialEvent(");
    expect(create).not.toMatch(/onDuplicateKeyUpdate/);
    expect(create).toMatch(/db\.transaction\(/);
    expect(create).toMatch(/insertProcess\(p, tx\)/);
  });

  it("createDirectProcurementWorkspaceWithInitialEvent: INSERT puro + evento na MESMA transação", () => {
    const create = fnBody(direct, "export async function createDirectProcurementWorkspaceWithInitialEvent(");
    expect(create).not.toMatch(/onDuplicateKeyUpdate/);
    expect(create).toMatch(/db\.transaction\(/);
    expect(create).toMatch(/tx\.insert\(directProcurementWorkspacesTable\)/);
    expect(create).toMatch(/throw new ProcessAlreadyExistsError\(ws\.id\)/);
    expect(create).toMatch(/recordProcessEvent\([\s\S]*\}, tx\)/);
  });

  it("os routers criam SÓ pelos caminhos estritos e resolvem o conflito sem escrever", () => {
    const pp = src("server/routers/procurementProcessRouter.ts");
    const dp = src("server/routers/directProcurementRouter.ts");
    const ppCreate = pp.slice(pp.indexOf("createProcess: orgRoleProcedure(\"operator\")"), pp.indexOf("loadProcess:"));
    const dpCreate = dp.slice(dp.indexOf("createProcess: orgRoleProcedure(\"operator\")"), dp.indexOf("loadProcess:"));
    expect(ppCreate).toMatch(/createProcessWithInitialEvent\(/);
    expect(ppCreate).toMatch(/err instanceof ProcessAlreadyExistsError/);
    expect(dpCreate).toMatch(/createDirectProcurementWorkspaceWithInitialEvent\(/);
    expect(dpCreate).toMatch(/err instanceof ProcessAlreadyExistsError/);
    expect(dpCreate).not.toMatch(/insertDirectProcurementWorkspace\(/); // o upsert de "salvar" não é caminho de criação
    // resolução do conflito: só leituras (nenhum insert/update/recordProcessEvent)
    for (const [code, fn] of [[pp, "async function resolveExistingProcurementCreate("], [dp, "async function resolveExistingDirectCreate("]] as const) {
      const start = code.indexOf(fn);
      expect(start, fn).toBeGreaterThanOrEqual(0);
      const body = code.slice(start, code.indexOf("\n}\n", start));
      expect(body).not.toMatch(/insert|update|recordProcessEvent|recordContextAssertions|appendContextFacts/i);
      expect(body).toMatch(/code: "CONFLICT"/);
    }
  });
});
