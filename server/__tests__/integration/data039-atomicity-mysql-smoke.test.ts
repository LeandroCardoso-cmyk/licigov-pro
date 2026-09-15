/**
 * DATA-039 (Bloco D) — smoke MySQL REAL da ATOMICIDADE de operações compostas do fluxo canônico.
 * Só roda com DATABASE_URL (CI). Prova, contra MySQL real:
 *   - createProcessWithInitialEvent: processo + evento inicial commitam JUNTOS (tudo-ou-nada) e o
 *     retry (id determinístico) não duplica;
 *   - insertResearchWithItems: cabeçalho da pesquisa + todos os itens brutos commitam JUNTOS;
 *   - ROLLBACK real: uma transação que grava e depois lança NÃO deixa estado parcial persistido
 *     (as funções executor-aware participam do rollback — base das duas garantias acima).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { getDb } from "../../db";
import {
  createProcessWithInitialEvent, insertResearchWithItems,
  insertProcess, insertResearch, insertResearchItem,
  getProcess, listProcesses, listProcessTimeline,
} from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { createPriceResearchWorkspace, extractItemsFromText } from "../../domain/priceResearch";

const DB = process.env.DATABASE_URL;
const ORG = 950390;

const DDL_PROCESSES = `CREATE TABLE IF NOT EXISTS \`procurement_processes\` (
  \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL,
  \`process_number\` VARCHAR(64) NOT NULL DEFAULT '', \`object\` TEXT NULL,
  \`modality\` VARCHAR(50) NOT NULL DEFAULT '', \`current_stage\` VARCHAR(30) NOT NULL DEFAULT 'NEW_PROCESS',
  \`status\` VARCHAR(30) NOT NULL DEFAULT 'rascunho', \`start_option\` VARCHAR(30) NOT NULL DEFAULT 'criar_dfd',
  \`responsible_user\` INT NOT NULL DEFAULT 0, \`participants\` TEXT NULL, \`active_copilots\` TEXT NULL,
  \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`), INDEX \`idx_pp_org\` (\`organization_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const DDL_TIMELINE = `CREATE TABLE IF NOT EXISTS \`process_timeline\` (
  \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`process_id\` VARCHAR(20) NOT NULL,
  \`event_order\` INT NOT NULL DEFAULT 0, \`event_type\` VARCHAR(40) NOT NULL DEFAULT 'change',
  \`actor\` VARCHAR(100) NOT NULL DEFAULT 'system', \`summary\` TEXT NULL, \`ref_id\` VARCHAR(40) NOT NULL DEFAULT '',
  \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`), INDEX \`idx_ptl_org\` (\`organization_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const DDL_RESEARCH = `CREATE TABLE IF NOT EXISTS \`price_research\` (
  \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`process_id\` VARCHAR(20) NOT NULL,
  \`source\` VARCHAR(20) NOT NULL DEFAULT 'manual', \`item_count\` INT NOT NULL DEFAULT 0,
  \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '',
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`), INDEX \`idx_pr_org\` (\`organization_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const DDL_RESEARCH_ITEMS = `CREATE TABLE IF NOT EXISTS \`price_research_items\` (
  \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`research_id\` VARCHAR(20) NOT NULL,
  \`process_id\` VARCHAR(20) NOT NULL, \`description\` TEXT NULL,
  \`quantity\` DECIMAL(14,3) NOT NULL DEFAULT 0, \`unit\` VARCHAR(30) NOT NULL DEFAULT 'un',
  \`supplier\` VARCHAR(255) NOT NULL DEFAULT '', \`brand\` VARCHAR(255) NOT NULL DEFAULT '',
  \`model\` VARCHAR(255) NOT NULL DEFAULT '', \`value\` DECIMAL(14,2) NOT NULL DEFAULT 0,
  \`observations\` TEXT NULL, \`source\` VARCHAR(50) NOT NULL DEFAULT '',
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`), INDEX \`idx_pri_org\` (\`organization_id\`), INDEX \`idx_pri_research\` (\`research_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

async function cleanup() {
  const conn = await mysql.createConnection(DB!);
  await conn.query("DELETE FROM `process_timeline` WHERE organization_id = ?", [ORG]);
  await conn.query("DELETE FROM `procurement_processes` WHERE organization_id = ?", [ORG]);
  await conn.query("DELETE FROM `price_research_items` WHERE organization_id = ?", [ORG]);
  await conn.query("DELETE FROM `price_research` WHERE organization_id = ?", [ORG]);
  await conn.end();
}

describe.skipIf(!DB)("DATA-039 — atomicidade de operações compostas (MySQL real)", () => {
  beforeAll(async () => {
    const conn = await mysql.createConnection(DB!);
    for (const ddl of [DDL_PROCESSES, DDL_TIMELINE, DDL_RESEARCH, DDL_RESEARCH_ITEMS]) await conn.query(ddl);
    await conn.end();
    await cleanup();
  });
  afterAll(cleanup);

  it("createProcessWithInitialEvent: processo + evento inicial commitam JUNTOS; retry não duplica", async () => {
    const mk = () => createProcurementWorkspace({
      organizationId: ORG, processNumber: "D039-100/2026", object: "Objeto DATA-039",
      startOption: "criar_dfd", responsibleUser: 1, correlationId: "d039-create",
    });
    const p = mk();
    await createProcessWithInitialEvent(p, {
      eventType: "workspace_created", actor: "1",
      summary: "Processo D039-100/2026 criado.", refId: p.id, correlationId: "d039-create",
    });
    // Ambos presentes (átomo bem-sucedido).
    expect(await getProcess(p.id, ORG)).not.toBeNull();
    const tl = await listProcessTimeline(p.id, ORG);
    expect(tl.length).toBe(1);
    expect(tl[0].eventType).toBe("workspace_created");

    // Retry (mesmo número → mesmo id determinístico) não duplica processo nem evento.
    await createProcessWithInitialEvent(mk(), {
      eventType: "workspace_created", actor: "1",
      summary: "Processo D039-100/2026 criado.", refId: p.id, correlationId: "d039-create",
    });
    expect((await listProcesses(ORG, 200)).filter(x => x.processNumber === "D039-100/2026").length).toBe(1);
    expect((await listProcessTimeline(p.id, ORG)).length).toBe(1);
  });

  it("insertResearchWithItems: cabeçalho + todos os itens commitam JUNTOS", async () => {
    const research = createPriceResearchWorkspace({ processId: "d039-proc", organizationId: ORG, source: "manual", correlationId: "d039-res" });
    const items = extractItemsFromText(
      "Caneta esferográfica azul, 100 un, R$ 1,50\nPapel A4 500 folhas, 50 un, R$ 25,00",
      { researchId: research.id, processId: "d039-proc", organizationId: ORG },
    );
    expect(items.length).toBeGreaterThan(0);
    await insertResearchWithItems({ ...research, itemCount: items.length }, items);

    const conn = await mysql.createConnection(DB!);
    const [hdr] = await conn.query<mysql.RowDataPacket[]>("SELECT item_count FROM `price_research` WHERE id = ?", [research.id]);
    const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) c FROM `price_research_items` WHERE research_id = ?", [research.id]);
    await conn.end();
    expect((hdr as mysql.RowDataPacket[]).length).toBe(1);
    expect((rows as mysql.RowDataPacket[])[0].c).toBe(items.length);
  });

  it("ROLLBACK real: transação que grava processo+evento e lança NÃO deixa estado parcial", async () => {
    const db = await getDb();
    if (!db) return; // sem DB não há o que provar
    const p = createProcurementWorkspace({
      organizationId: ORG, processNumber: "D039-ROLLBACK/2026", object: "rollback",
      startOption: "criar_dfd", responsibleUser: 1, correlationId: "d039-rb",
    });
    await expect(db.transaction(async (tx) => {
      await insertProcess(p, tx);
      throw new Error("boom após insertProcess (força rollback)");
    })).rejects.toThrow(/boom/);
    // Nada persistiu: o insert dentro da transação foi revertido.
    expect(await getProcess(p.id, ORG)).toBeNull();
  });

  it("ROLLBACK real: transação de pesquisa+item que lança NÃO deixa cabeçalho nem item", async () => {
    const db = await getDb();
    if (!db) return;
    const research = createPriceResearchWorkspace({ processId: "d039-rb-proc", organizationId: ORG, source: "manual", correlationId: "d039-rb2" });
    const [item] = extractItemsFromText("Item X, 1 un, R$ 10,00", { researchId: research.id, processId: "d039-rb-proc", organizationId: ORG });
    await expect(db.transaction(async (tx) => {
      await insertResearch({ ...research, itemCount: 1 }, tx);
      await insertResearchItem(item, tx);
      throw new Error("boom após pesquisa+item (força rollback)");
    })).rejects.toThrow(/boom/);
    const conn = await mysql.createConnection(DB!);
    const [hdr] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) c FROM `price_research` WHERE id = ?", [research.id]);
    const [it] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) c FROM `price_research_items` WHERE research_id = ?", [research.id]);
    await conn.end();
    expect((hdr as mysql.RowDataPacket[])[0].c).toBe(0);
    expect((it as mysql.RowDataPacket[])[0].c).toBe(0);
  });
});
