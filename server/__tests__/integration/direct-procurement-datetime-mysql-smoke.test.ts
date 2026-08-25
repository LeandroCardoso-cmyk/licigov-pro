/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.3A-OPS.3 — DATETIME da Contratação Direta contra MySQL REAL em MODO ESTRITO (CI). Executável.
 *
 * Reproduz a falha de staging: o domínio gera timestamps `new Date().toISOString()` (com `T`/`Z`), que
 * colunas `DATETIME(3)` em `STRICT_TRANS_TABLES` rejeitam ("Incorrect datetime value"). Prova:
 *   - CONTROLE: um INSERT DIRETO de ISO cru na coluna DATETIME(3) FALHA sob modo estrito (regressão viva);
 *   - o writer REAL corrigido (`insertDirectProcurementWorkspace`) PERSISTE e faz round-trip ISO→DB→ISO
 *     com precisão de ms; tenant + correlationId preservados; ON DUPLICATE KEY UPDATE funciona;
 *   - writer irmão com timestamp adicional (`insertRatification` → ratifiedAt) também persiste.
 * NÃO relaxa o sql_mode em nenhum momento. Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { createDirectProcurementWorkspace } from "../../domain/directProcurementWorkspace";
import { createRatification } from "../../domain/directProcurementJustifications";
import {
  insertDirectProcurementWorkspace, getDirectProcurementWorkspace, listDirectProcurementWorkspaces,
  insertRatification, getRatification,
} from "../../db/directProcurement";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 950801;
const ACTOR = 6011;

let conn: mysql.Connection;

describe.skipIf(!DB)("C.3A-OPS.3 — DATETIME Contratação Direta (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    // Modo estrito GLOBAL → conexões novas do pool getDb() (criadas nos writers abaixo) herdam;
    // e SESSION na minha conexão para o teste de CONTROLE. Nunca relaxamos o modo.
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [ORG, "DP DateTime Org", "dp-datetime"]).catch(() => {});
    await conn.execute("DELETE FROM direct_procurement_workspaces WHERE organization_id = ?", [ORG]).catch(() => {});
    await conn.execute("DELETE FROM ratifications WHERE organization_id = ?", [ORG]).catch(() => {});
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await conn.execute("DELETE FROM direct_procurement_workspaces WHERE organization_id = ?", [ORG]).catch(() => {});
    await conn.execute("DELETE FROM ratifications WHERE organization_id = ?", [ORG]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id = ?", [ORG]).catch(() => {});
    await conn.end();
  });

  it("CONTROLE: ISO cru (T/Z) em DATETIME(3) é rejeitado sob modo estrito (regressão viva)", async () => {
    const iso = new Date().toISOString(); // 2026-...T..Z
    let threw = false;
    try {
      await conn.execute(
        "INSERT INTO direct_procurement_workspaces (id, organization_id, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ["ctl_raw_iso_0001", ORG, iso, iso],
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    // nada persistido pelo controle
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM direct_procurement_workspaces WHERE id = 'ctl_raw_iso_0001'",
    );
    expect(Number((rows[0] as any).n)).toBe(0);
  }, 60_000);

  it("writer REAL corrigido persiste sob modo estrito + round-trip ISO com precisão de ms", async () => {
    const ws = createDirectProcurementWorkspace({
      organizationId: ORG, processNumber: "DISPENSA-0001/2026", object: "Aquisição fictícia de homologação",
      procurementType: "dispensa", startOption: "sem_dfd", legalBasis: "sem_dfd",
      responsibleUser: ACTOR, correlationId: "corr-dp-dt-1",
    });
    // valores reais do fluxo UI observados na falha
    expect(ws.procurementType).toBe("dispensa");
    expect(ws.procedureType).toBe("indefinido");
    expect(ws.currentStage).toBe("LEGAL_BASIS");
    expect(ws.status).toBe("rascunho");

    const saved = await insertDirectProcurementWorkspace(ws);
    expect(saved).not.toBeNull(); // INSERT não lançou sob modo estrito

    const back = await getDirectProcurementWorkspace(ws.id, ORG);
    expect(back).not.toBeNull();
    // round-trip: ISO válido (T…Z) e semanticamente igual, com precisão de ms preservada (DATETIME(3))
    expect(back!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(back!.createdAt).getTime()).toBe(new Date(ws.createdAt).getTime());
    expect(new Date(back!.updatedAt).getTime()).toBe(new Date(ws.updatedAt).getTime());
    // tenant + correlationId preservados
    expect(back!.organizationId).toBe(ORG);
    expect(back!.correlationId).toBe("corr-dp-dt-1");
  }, 60_000);

  it("ON DUPLICATE KEY UPDATE continua funcionando (mesmo id, novo updatedAt)", async () => {
    const ws1 = createDirectProcurementWorkspace({
      organizationId: ORG, processNumber: "DISPENSA-0002/2026", object: "Objeto v1",
      procurementType: "dispensa", startOption: "sem_dfd", responsibleUser: ACTOR, correlationId: "corr-dp-dt-2",
    });
    await insertDirectProcurementWorkspace(ws1);
    const ws2 = { ...ws1, updatedAt: new Date(Date.now() + 5000).toISOString() };
    const saved = await insertDirectProcurementWorkspace(ws2);
    expect(saved).not.toBeNull(); // upsert não lançou
    const back = await getDirectProcurementWorkspace(ws1.id, ORG);
    expect(new Date(back!.updatedAt).getTime()).toBe(new Date(ws2.updatedAt).getTime());
    // list também retorna updatedAt em ISO
    const list = await listDirectProcurementWorkspaces(ORG, 50);
    const row = list.find(w => w.id === ws1.id);
    expect(row!.updatedAt).toMatch(/Z$/);
  }, 60_000);

  it("writer irmão (ratification, ratifiedAt) também persiste sob modo estrito com round-trip", async () => {
    const ws = createDirectProcurementWorkspace({
      organizationId: ORG, processNumber: "DISPENSA-0003/2026", object: "Objeto ratificável",
      procurementType: "dispensa", startOption: "sem_dfd", responsibleUser: ACTOR, correlationId: "corr-dp-dt-3",
    });
    await insertDirectProcurementWorkspace(ws);
    const rat = createRatification({ organizationId: ORG, workspaceId: ws.id, responsible: ACTOR, correlationId: "corr-dp-dt-3" });
    const savedRat = await insertRatification(rat);
    expect(savedRat).not.toBeNull();
    const back = await getRatification(ws.id, ORG);
    expect(back).not.toBeNull();
    expect(back!.ratifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(back!.ratifiedAt).getTime()).toBe(new Date(rat.ratifiedAt).getTime());
  }, 60_000);
});
