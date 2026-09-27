/**
 * R1 / PR-01A (NEW-001) — regra de replay da atribuição de etapa + guarda estática do boundary transacional.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { decideStageAssignment, normalizeStageNote } from "../domain/stageAssignment";

describe("decideStageAssignment", () => {
  it("sem linha ⇒ insert", () => {
    expect(decideStageAssignment([], { assignedUserId: 1, note: null })).toBe("insert");
  });
  it("mesmo usuário e mesma nota ⇒ unchanged (replay idempotente)", () => {
    expect(decideStageAssignment([{ assignedUserId: 1, note: "a" }], { assignedUserId: 1, note: "a" })).toBe("unchanged");
  });
  it("nota ausente, null e vazia são equivalentes", () => {
    expect(decideStageAssignment([{ assignedUserId: 1, note: null }], { assignedUserId: 1, note: "" })).toBe("unchanged");
    expect(decideStageAssignment([{ assignedUserId: 1, note: "" }], { assignedUserId: 1, note: null })).toBe("unchanged");
    expect(normalizeStageNote(undefined)).toBeNull();
  });
  it("usuário ou nota diferente ⇒ update", () => {
    expect(decideStageAssignment([{ assignedUserId: 1, note: "a" }], { assignedUserId: 2, note: "a" })).toBe("update");
    expect(decideStageAssignment([{ assignedUserId: 1, note: "a" }], { assignedUserId: 1, note: "b" })).toBe("update");
  });
  it("duplicatas históricas: unchanged só se TODAS já expressam o estado pedido", () => {
    const req = { assignedUserId: 1, note: null };
    expect(decideStageAssignment([{ assignedUserId: 1, note: null }, { assignedUserId: 1, note: null }], req)).toBe("unchanged");
    expect(decideStageAssignment([{ assignedUserId: 1, note: null }, { assignedUserId: 9, note: null }], req)).toBe("update");
  });
});

describe("boundary transacional de assignStage (guarda estática)", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  it("primitivas *Tx da camada de dados nunca abrem conexão própria (getDb) — usam o executor recebido", () => {
    const src = read("server/db/collaboration.ts");
    const names = ["lockProcessForOrganizationTx", "getStageAssignmentRowsTx", "insertStageAssignmentTx",
      "updateStageAssignmentTx", "insertNotificationTx", "insertActivityLogForOrganizationTx"];
    for (const name of names) {
      const start = src.indexOf(`export async function ${name}(`);
      expect(start, name).toBeGreaterThan(-1);
      const next = src.indexOf("\nexport ", start + 1);
      const body = src.slice(start, next === -1 ? undefined : next);
      expect(body, name).not.toContain("getDb(");
    }
  });

  it("o service faz TODAS as escritas dentro de UMA transação e não usa lookups globais nem side effects remotos", () => {
    const src = read("server/services/stageAssignmentService.ts");
    expect(src.match(/\.transaction\(/g)?.length).toBe(1);
    for (const forbidden of ["getProcessById(", "getUserById(", "getUserByEmail(", "createNotification(",
      "createActivityLogForOrganization(", "fetch(", "sendEmail", "enqueueEmail", "invokeLLM", "storagePut"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("o router delega assignStage ao boundary transacional e não grava atribuição fora dele", () => {
    const src = read("server/routers/collaborationRouter.ts");
    const start = src.indexOf("assignStage: tenantProcedure");
    const body = src.slice(start, src.indexOf("unassignStage: tenantProcedure"));
    expect(body).toContain("assignStageAtomically(");
    for (const forbidden of ["db.createNotification(", "logActivity(", "db.upsertStageAssignment(", "db.insert"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
    expect(src).not.toMatch(/db\.getProcessById\(|db\.getUserById\(|db\.getUserByEmail\(/);
  });
});
