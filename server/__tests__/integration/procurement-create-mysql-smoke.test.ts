/**
 * Smoke MySQL REAL — criação canônica de Processo Licitatório (regressão de DATETIME).
 *
 * A suíte usa persistência in-memory/mockada; por isso o bug de formato de data
 * (ISO "…T…Z" em coluna DATETIME) escapou no fluxo canônico recém-conectado
 * (PR B). Este teste exercita o REPOSITÓRIO MYSQL de verdade: só roda quando
 * `DATABASE_URL` está definido (CI com MySQL efêmero) e é PULADO sem banco.
 *
 * Garante: o processo é gravado e recuperado no MySQL sem erro de DATETIME,
 * as datas voltam como ISO válido (round-trip), o isolamento por tenant é real,
 * e o retry (mesmo número) NÃO cria duplicata (idempotência).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import {
  insertProcess, getProcess, listProcesses, recordProcessEvent, listProcessTimeline,
} from "../../db/procurement";

const DB = process.env.DATABASE_URL;

const DDL_PROCESSES = `CREATE TABLE IF NOT EXISTS \`procurement_processes\` (
  \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
  \`process_number\` VARCHAR(64) NOT NULL DEFAULT '', \`object\` TEXT NULL,
  \`modality\` VARCHAR(50) NOT NULL DEFAULT '',
  \`current_stage\` VARCHAR(30) NOT NULL DEFAULT 'NEW_PROCESS',
  \`status\` VARCHAR(30) NOT NULL DEFAULT 'rascunho',
  \`start_option\` VARCHAR(30) NOT NULL DEFAULT 'criar_dfd',
  \`responsible_user\` INT NOT NULL DEFAULT 0, \`participants\` TEXT NULL, \`active_copilots\` TEXT NULL,
  \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`), INDEX \`idx_pp_org\` (\`organization_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const DDL_TIMELINE = `CREATE TABLE IF NOT EXISTS \`process_timeline\` (
  \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
  \`process_id\` VARCHAR(20) NOT NULL, \`event_order\` INT NOT NULL DEFAULT 0,
  \`event_type\` VARCHAR(40) NOT NULL DEFAULT 'change', \`actor\` VARCHAR(100) NOT NULL DEFAULT 'system',
  \`summary\` TEXT NULL, \`ref_id\` VARCHAR(40) NOT NULL DEFAULT '',
  \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`), INDEX \`idx_ptl_org\` (\`organization_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const ORG_A = 950100;
const ORG_B = 950101;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function cleanup() {
  const conn = await mysql.createConnection(DB!);
  await conn.query("DELETE FROM `procurement_processes` WHERE organization_id IN (?, ?)", [ORG_A, ORG_B]);
  await conn.query("DELETE FROM `process_timeline` WHERE organization_id IN (?, ?)", [ORG_A, ORG_B]);
  await conn.end();
}

describe.skipIf(!DB)("Smoke MySQL real — criação canônica de Processo Licitatório", () => {
  beforeAll(async () => {
    const conn = await mysql.createConnection(DB!);
    await conn.query(DDL_PROCESSES);
    await conn.query(DDL_TIMELINE);
    await conn.end();
    await cleanup();
  });
  afterAll(cleanup);

  it("grava e recupera o processo no MySQL real, sem erro de DATETIME, com datas ISO", async () => {
    const process = createProcurementWorkspace({
      organizationId: ORG_A, processNumber: "100/2026",
      object: "Aquisição de Equipamentos de Informática", startOption: "criar_dfd",
      responsibleUser: 1, correlationId: `smoke:${Date.now()}`,
    });

    // O bug original lançava EXATAMENTE AQUI (INSERT com ISO "…T…Z" em DATETIME).
    await insertProcess(process);
    await recordProcessEvent({
      organizationId: ORG_A, processId: process.id, eventType: "workspace_created",
      actor: "1", summary: "Processo 100/2026 criado (início: criar_dfd).", refId: process.id, correlationId: process.correlationId,
    });

    const reloaded = await getProcess(process.id, ORG_A);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.id).toBe(process.id);
    expect(reloaded!.processNumber).toBe("100/2026");
    expect(reloaded!.startOption).toBe("criar_dfd");
    // Round-trip: datas voltam como ISO válido.
    expect(reloaded!.createdAt).toMatch(ISO);
    expect(new Date(reloaded!.createdAt).toString()).not.toBe("Invalid Date");
    expect(reloaded!.updatedAt).toMatch(ISO);

    // Timeline gravada sem erro de DATETIME.
    const timeline = await listProcessTimeline(process.id, ORG_A);
    expect(timeline.length).toBe(1);
    expect(timeline[0].createdAt).toMatch(ISO);
  });

  it("isola por tenant: outro org NÃO enxerga o processo", async () => {
    const process = createProcurementWorkspace({
      organizationId: ORG_A, processNumber: "200/2026", object: "Objeto A",
      startOption: "iniciar_etp", responsibleUser: 1, correlationId: "smoke-iso",
    });
    await insertProcess(process);
    expect(await getProcess(process.id, ORG_A)).not.toBeNull();
    expect(await getProcess(process.id, ORG_B)).toBeNull(); // cross-tenant → null
  });

  it("retry com o mesmo número NÃO cria duplicata (id determinístico + onDuplicateKeyUpdate)", async () => {
    const mk = () => createProcurementWorkspace({
      organizationId: ORG_A, processNumber: "300/2026", object: "Objeto retry",
      startOption: "criar_dfd", responsibleUser: 1, correlationId: "smoke-retry",
    });
    await insertProcess(mk());
    await insertProcess(mk()); // segundo clique/retry

    const rows = (await listProcesses(ORG_A, 200)).filter(p => p.processNumber === "300/2026");
    expect(rows.length).toBe(1);
    // A modalidade real é projetada (Escopo 3 — Central).
    expect(rows[0].modality).toBeDefined();
    expect(rows[0].updatedAt).toMatch(ISO);
  });
});
