/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CONTRATO VIGENTE LEGADO — RETOMADA após falha parcial (MySQL REAL, tenant SINTÉTICO, router real).
 * Antes: a repetição convergente (mesmo ator, mesmos dados) devolvia o contrato e PULAVA o que faltava (aditivos anteriores,
 * vínculo do registro, vencimento). Agora cada passo é retomado de forma idempotente, sem duplicar nada.
 *  R1  falha no vínculo do registro (após o contrato existir) ⇒ nova tentativa completa vínculo, histórico e vencimento; 3ª tentativa nada grava
 *  R2  contrato externo monitorado: falha ao gravar o vencimento do contrato ⇒ o vencimento do REGISTRO não se perde; retomada transfere sem duplicar
 *  R3  registro ligado a OUTRO contrato continua recusado sem escrita
 *  R4  retomada que diverge (outro registro, outro término, outro histórico) ⇒ CONFLICT sem escrita
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const fault = vi.hoisted(() => ({ link: false, expiration: false }));
vi.mock("../../services/operationRecordService", async (orig) => {
  const actual = await orig<typeof import("../../services/operationRecordService")>();
  return {
    ...actual,
    linkRecordToContract: async (...a: Parameters<typeof actual.linkRecordToContract>) => {
      if (fault.link) { fault.link = false; throw new Error("falha simulada no vínculo"); }
      return actual.linkRecordToContract(...a);
    },
    registerExpiration: async (...a: Parameters<typeof actual.registerExpiration>) => {
      if (fault.expiration && a[0].kind === "contrato" && !a[0].referenceId.startsWith("rec")) { fault.expiration = false; throw new Error("falha simulada no vencimento"); }
      return actual.registerExpiration(...a);
    },
  };
});

import { runMigrations } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const ORG = 996711;
const RUN = Date.now().toString(36);
const TODAY = new Date().toISOString().slice(0, 10);
const plusDays = (d: number) => { const t = new Date(`${TODAY}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };

let conn: mysql.Connection;
const U = { manager: 0, operator: 0 };
let seq = 0;
async function caller(userId: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: userId, role: "user", name: `Ator ${userId}`, email: `lcr-${userId}@teste.local` },
    req: { headers: { "x-organization-id": String(ORG) }, ip: "127.0.0.1" }, res: {}, correlationId: `corr-lcr-${userId}-${++seq}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
const rows = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
const n = async (sql: string, p: unknown[] = []) => Number((await rows<{ n: number }>(sql, p))[0].n);
async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
}
async function cleanup() {
  for (const t of ["contract_addenda", "contract_workspaces", "operational_events", "operational_timeline", "operation_records", "process_timeline"]) {
    await conn.execute(`DELETE FROM ${t} WHERE organization_id = ?`, [ORG]).catch(() => {});
  }
  await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [ORG]).catch(() => {});
  await conn.execute("DELETE FROM organization_members WHERE organizationId = ?", [ORG]).catch(() => {});
}
const snapshot = async (cid: string, recordId: string) => ({
  addenda: await n("SELECT COUNT(*) n FROM contract_addenda WHERE organization_id = ? AND contract_id = ?", [ORG, cid]),
  created: await n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ? AND event_type = 'workspace_created'", [ORG, cid]),
  priorEvents: await n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ? AND summary LIKE '%aditivo(s) anterior(es)%'", [ORG, cid]),
  contractExpiry: await n("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ? AND event_type = 'vencimento_contrato'", [ORG, cid]),
  recordExpiry: await n("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ?", [ORG, recordId]),
  linkedTo: (await rows<{ r: string | null }>("SELECT reference_id r FROM operation_records WHERE id = ?", [recordId]))[0]?.r || null,
  scheduledAudit: await n("SELECT COUNT(*) n FROM operational_timeline WHERE organization_id = ? AND action = 'vencimento_agendado' AND reference_id = ?", [ORG, cid]),
});

describe.skipIf(!DB)("Contrato vigente legado — retomada após falha parcial (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [ORG, `Prefeitura Sintética LCR ${ORG}`, `lcr-sintetica-${ORG}`]);
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`lcr-${k}-${RUN}`, `Sintético ${k}`, `lcr-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [ORG, r.insertId, k]);
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`lcr-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id = ?", [ORG]).catch(() => {});
    await conn.end();
  });

  it("R1 — falha no vínculo: a nova tentativa completa vínculo, histórico e vencimento; a seguinte não grava nada", async () => {
    const op = await caller(U.operator);
    const mgr = await caller(U.manager);
    const imp = await op.operationRecord.importLegacy({ recordType: "processo_licitatorio_legado", rawText: "Processo nº 77/2022\nModalidade: Pregão Eletrônico\nObjeto: Coleta de resíduos (sintético)." });
    const recordId = imp.record.id;
    const input = {
      contractNumber: `CT-R1-${RUN}`, contractor: "Fornecedor Sintético R1", term: "12 meses", value: 1000, endDate: plusDays(40), legacyRecordId: recordId,
      priorAmendments: [{ type: "prazo" as const, newTerm: "12 meses", reference: "1º TA (sintético)" }, { type: "valor" as const, reference: "2º TA (sintético)" }],
    };
    fault.link = true;
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `r1a-${RUN}` })))?.message).toMatch(/falha simulada/);
    const cid = (await rows<{ id: string }>("SELECT id FROM contract_workspaces WHERE organization_id = ? AND contract_number = ?", [ORG, input.contractNumber]))[0].id;
    // Estado parcial real: contrato criado com histórico, mas sem vínculo e sem vencimento.
    expect(await snapshot(cid, recordId)).toMatchObject({ addenda: 2, created: 1, linkedTo: null, contractExpiry: 0 });

    // Nova tentativa (mesma chave falhada ou nova): converge e RETOMA.
    const r = await mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `r1a-${RUN}` });
    expect(r.workspace.id).toBe(cid);
    expect(r.created).toBe(false);
    expect(r.legacyRecord).toMatchObject({ id: recordId });
    const done = await snapshot(cid, recordId);
    expect(done).toMatchObject({ addenda: 2, created: 1, priorEvents: 1, linkedTo: cid, contractExpiry: 6, scheduledAudit: 1 });

    // 3ª tentativa (outra chave, mesmos dados): nada novo.
    await mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `r1b-${RUN}` });
    expect(await snapshot(cid, recordId)).toEqual(done);
  }, 120_000);

  it("R1b — histórico anterior perdido na 1ª tentativa é completado só nas sequências que faltam", async () => {
    const mgr = await caller(U.manager);
    const input = {
      contractNumber: `CT-R1B-${RUN}`, contractor: "Fornecedor Sintético R1B", object: "Serviço sintético", term: "6 meses",
      priorAmendments: [{ type: "prazo" as const, reference: "1º TA" }, { type: "valor" as const, reference: "2º TA" }, { type: "prazo" as const, reference: "3º TA" }],
    };
    const first = await mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `r1c-${RUN}` });
    const cid = first.workspace.id;
    await conn.execute("DELETE FROM contract_addenda WHERE organization_id = ? AND contract_id = ? AND sequence >= 2", [ORG, cid]); // emula falha no meio do laço
    await mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `r1d-${RUN}` });
    expect((await rows<{ sequence: number }>("SELECT sequence FROM contract_addenda WHERE organization_id = ? AND contract_id = ? ORDER BY sequence", [ORG, cid])).map((a) => a.sequence)).toEqual([1, 2, 3]);
    // termo nº 2 registrado de outra forma ⇒ recusa, sem regravar
    await conn.execute("DELETE FROM contract_addenda WHERE organization_id = ? AND contract_id = ? AND sequence = 3", [ORG, cid]);
    await conn.execute("UPDATE contract_addenda SET id = ? WHERE organization_id = ? AND contract_id = ? AND sequence = 2", [`x${RUN}`.slice(0, 20), ORG, cid]);
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `r1e-${RUN}` })))?.code).toBe("CONFLICT");
    expect(await n("SELECT COUNT(*) n FROM contract_addenda WHERE organization_id = ? AND contract_id = ?", [ORG, cid])).toBe(2);
  }, 120_000);

  it("R2 — contrato externo monitorado: falha ao gravar o vencimento do contrato não perde o vencimento do registro; retomada transfere", async () => {
    const op = await caller(U.operator);
    const mgr = await caller(U.manager);
    const end = plusDays(30);
    const { record } = await op.operationRecord.createRecord({ recordType: "contrato_externo", origin: "externa", number: `CE-R2-${RUN}`, object: "Locação sintética", expirationDate: end });
    expect(await n("SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND reference_id = ?", [ORG, record.id])).toBe(6);
    const input = { contractNumber: `CT-R2-${RUN}`, contractor: "Locadora Sintética R2", term: "12 meses", legacyRecordId: record.id };
    fault.expiration = true;
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `r2a-${RUN}` })))?.message).toMatch(/falha simulada/);
    const cid = (await rows<{ id: string }>("SELECT id FROM contract_workspaces WHERE organization_id = ? AND contract_number = ?", [ORG, input.contractNumber]))[0].id;
    expect(await snapshot(cid, record.id)).toMatchObject({ linkedTo: cid, contractExpiry: 0, recordExpiry: 6 }); // nada perdido

    const r = await mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `r2a-${RUN}` });
    expect(r.legacyRecord).toMatchObject({ id: record.id, adoptedExpiration: end });
    const done = await snapshot(cid, record.id);
    expect(done).toMatchObject({ linkedTo: cid, contractExpiry: 6, recordExpiry: 0, scheduledAudit: 1 });
    expect(await n("SELECT COUNT(*) n FROM operational_timeline WHERE organization_id = ? AND action = 'vigencia_transferida' AND reference_id = ?", [ORG, record.id])).toBe(1);
    await mgr.contractWorkspace.registerInForceContract({ ...input, idempotencyKey: `r2b-${RUN}` });
    expect(await snapshot(cid, record.id)).toEqual(done);
  }, 120_000);

  it("R4 — retomada que DIVERGE do já gravado é recusada antes de qualquer escrita (outro registro, outro término, outro histórico)", async () => {
    const op = await caller(U.operator);
    const mgr = await caller(U.manager);
    const endA = plusDays(20);
    const a = await op.operationRecord.createRecord({ recordType: "contrato_externo", origin: "externa", number: `CE-R4A-${RUN}`, object: "Vigilância sintética", expirationDate: endA });
    const b = await op.operationRecord.createRecord({ recordType: "contrato_externo", origin: "externa", number: `CE-R4B-${RUN}`, object: "Vigilância sintética", expirationDate: plusDays(50) });
    const base = { contractNumber: `CT-R4-${RUN}`, contractor: "Vigilância Sintética", object: "Vigilância sintética", term: "12 meses",
      priorAmendments: [{ type: "prazo" as const, reference: "1º TA (sintético)" }] };
    const r = await mgr.contractWorkspace.registerInForceContract({ ...base, idempotencyKey: `r4a-${RUN}`, legacyRecordId: a.record.id });
    const cid = r.workspace.id;
    const before = { b: await snapshot(cid, b.record.id), a: await snapshot(cid, a.record.id) };

    // mesmo contrato a partir de OUTRO registro: recusa; o vencimento de B continua monitorado
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...base, idempotencyKey: `r4b-${RUN}`, legacyRecordId: b.record.id })))?.code).toBe("CONFLICT");
    // outro término: recusa (alteração de vigência é pelo aditivo de prazo)
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...base, idempotencyKey: `r4c-${RUN}`, legacyRecordId: a.record.id, endDate: plusDays(99) })))?.code).toBe("CONFLICT");
    // histórico anterior com outro conteúdo na mesma sequência: recusa
    expect((await err(mgr.contractWorkspace.registerInForceContract({ ...base, idempotencyKey: `r4d-${RUN}`, legacyRecordId: a.record.id, priorAmendments: [{ type: "valor" as const, reference: "1º TA (sintético)" }] })))?.code).toBe("CONFLICT");
    expect({ b: await snapshot(cid, b.record.id), a: await snapshot(cid, a.record.id) }).toEqual(before);
    expect(before.b).toMatchObject({ linkedTo: null, recordExpiry: 6 });
    // mesmo término já gravado ⇒ converge sem nada novo
    await mgr.contractWorkspace.registerInForceContract({ ...base, idempotencyKey: `r4e-${RUN}`, legacyRecordId: a.record.id, endDate: endA });
    expect(await snapshot(cid, a.record.id)).toEqual(before.a);
  }, 120_000);

  it("R3 — registro já ligado a OUTRO contrato continua recusado sem escrita", async () => {
    const op = await caller(U.operator);
    const mgr = await caller(U.manager);
    const imp = await op.operationRecord.importLegacy({ recordType: "processo_licitatorio_legado", rawText: "Processo nº 88/2022\nObjeto: Transporte escolar (sintético)." });
    await mgr.contractWorkspace.registerInForceContract({ idempotencyKey: `r3a-${RUN}`, contractNumber: `CT-R3A-${RUN}`, contractor: "F R3", term: "12 meses", legacyRecordId: imp.record.id });
    const before = await n("SELECT COUNT(*) n FROM contract_workspaces WHERE organization_id = ?", [ORG]);
    expect((await err(mgr.contractWorkspace.registerInForceContract({ idempotencyKey: `r3b-${RUN}`, contractNumber: `CT-R3B-${RUN}`, contractor: "F R3", term: "12 meses", legacyRecordId: imp.record.id })))?.code).toBe("CONFLICT");
    expect(await n("SELECT COUNT(*) n FROM contract_workspaces WHERE organization_id = ?", [ORG])).toBe(before);
  }, 120_000);
});
