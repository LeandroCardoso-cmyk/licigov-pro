/**
 * R9 / SEM-070 — Centro de Operações: indicadores contados no banco com a definição correta (MySQL REAL).
 *
 * Exercita o SERVIÇO REAL (`getDashboard`, `getMonitoringPanel`, `getRecommendations`) e o writer real de
 * vencimentos (`registerExpiration`, 6 eventos por contrato). Prova:
 *  - "Contratos vencendo" = contratos DISTINTOS com término vigente em [hoje, hoje+30] — alertas não contam,
 *    prorrogação (nova data) substitui a anterior, encerrado/rescindido fora, fronteiras inclusivas;
 *  - "Tarefas pendentes" = tarefas abertas reais (não 0);
 *  - "Concluídos" exclui arquivados e a entrada em PUBLICATION; contagem NÃO truncada em 200;
 *  - "Atrasado" aparece no painel para agenda vencida não finalizada;
 *  - isolamento por tenant em todas as contagens.
 * Só roda com DATABASE_URL; PULADO sem banco. Org ids sintéticos 9607xx.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";

import { registerExpiration } from "../../services/operationRecordService";
import { getDashboard, getMonitoringPanel, getRecommendations } from "../../services/departmentOperationService";
import { addIsoDays } from "@shared/operationalIndicators";

const DB = process.env.DATABASE_URL;
const ORG_A = 960701;
const ORG_B = 960702;
const TODAY = "2026-09-29";
const ORGS = [ORG_A, ORG_B];

describe.skipIf(!DB)("R9 / SEM-070 — indicadores do Centro de Operações (MySQL real)", () => {
  let conn: mysql.Connection;

  async function cleanup() {
    const tables: Array<[string, string]> = [
      ["procurement_processes", "organization_id"], ["direct_procurement_workspaces", "organization_id"],
      ["contract_workspaces", "organization_id"], ["operational_events", "organization_id"],
      ["operational_timeline", "organization_id"], ["legal_opinion_workspaces", "organization_id"],
      ["institutional_requests", "organization_id"], ["operation_records", "organization_id"],
      ["tasks", "organizationId"],
    ];
    for (const [table, col] of tables) {
      await conn.query(`DELETE FROM \`${table}\` WHERE \`${col}\` IN (?, ?)`, ORGS).catch(() => {});
    }
  }

  async function expiration(org: number, contractId: string, date: string) {
    await registerExpiration({
      organizationId: org, kind: "contrato", referenceId: contractId, title: `Contrato ${contractId}`,
      expirationDate: date, actor: "1", correlationId: `r9-sem070-${org}-${contractId}-${date}`,
    });
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();

    // 205 processos ativos + 2 emitidos + 3 arquivados (A); antes a lista truncava em 200.
    const procRows: unknown[][] = [];
    for (let i = 0; i < 205; i++) procRows.push([`r9p-a-${i}`, ORG_A, `A-${i}`, "em_andamento", "ETP"]);
    for (let i = 0; i < 2; i++) procRows.push([`r9p-a-e${i}`, ORG_A, `A-E${i}`, "emitido", "ISSUED"]);
    for (let i = 0; i < 3; i++) procRows.push([`r9p-a-x${i}`, ORG_A, `A-X${i}`, "arquivado", "ARCHIVED"]);
    procRows.push([`r9p-b-0`, ORG_B, "B-0", "emitido", "ISSUED"]);
    await conn.query("INSERT INTO procurement_processes (id, organization_id, process_number, status, current_stage) VALUES ?", [procRows]);

    await conn.query("INSERT INTO direct_procurement_workspaces (id, organization_id, process_number, status, current_stage) VALUES ?", [[
      ["r9d-a-pub", ORG_A, "DA-1", "publicado", "PUBLICATION"],
      ["r9d-a-done", ORG_A, "DA-2", "concluido", "CONTRACT"],
      ["r9d-a-arch", ORG_A, "DA-3", "arquivado", "ARCHIVED"],
    ]]);

    await conn.query("INSERT INTO contract_workspaces (id, organization_id, contract_number, status) VALUES ?", [[
      ["r9c-a1", ORG_A, "CA-1", "vigente"], ["r9c-a2", ORG_A, "CA-2", "rescindido"], ["r9c-a3", ORG_A, "CA-3", "vigente"],
      ["r9c-a5", ORG_A, "CA-5", "vigente"], ["r9c-a6", ORG_A, "CA-6", "vigente"], ["r9c-b1", ORG_B, "CB-1", "vigente"],
    ]]);
    await expiration(ORG_A, "r9c-a1", addIsoDays(TODAY, 10));   // conta (6 eventos ⇒ 1 contrato)
    await expiration(ORG_A, "r9c-a2", addIsoDays(TODAY, 5));    // rescindido ⇒ fora
    await expiration(ORG_A, "r9c-a3", addIsoDays(TODAY, 10));   // prorrogado ⇒ término vigente fora da janela
    await expiration(ORG_A, "r9c-a3", addIsoDays(TODAY, 100));
    await expiration(ORG_A, "r9c-a4", addIsoDays(TODAY, 30));   // sem workspace, fronteira final ⇒ conta
    await expiration(ORG_A, "r9c-a5", addIsoDays(TODAY, 31));   // fora da janela
    await expiration(ORG_A, "r9c-a6", addIsoDays(TODAY, -1));   // já vencido ⇒ fora
    await expiration(ORG_A, "r9c-a7", TODAY);                   // vence hoje ⇒ conta
    await expiration(ORG_B, "r9c-b1", addIsoDays(TODAY, 3));    // outro tenant

    await conn.query("INSERT INTO tasks (organizationId, title, type, status, priority, assignedTo, createdBy) VALUES ?", [[
      [ORG_A, "T1", "x", "pendente", "media", 1, 1], [ORG_A, "T2", "x", "em_andamento", "media", 1, 1],
      [ORG_A, "T3", "x", "atrasada", "media", 1, 1], [ORG_A, "T4", "x", "concluida", "media", 1, 1],
      [ORG_A, "T5", "x", "cancelada", "media", 1, 1], [ORG_B, "TB", "x", "pendente", "media", 1, 1],
    ]]);

    await conn.query("INSERT INTO legal_opinion_workspaces (id, organization_id, request_id, current_stage) VALUES ?", [[
      ["r9l-a1", ORG_A, "rq1", "INBOX"], ["r9l-a2", ORG_A, "rq2", "ANALYSIS"], ["r9l-a3", ORG_A, "rq3", "ARCHIVED"],
      ["r9l-b1", ORG_B, "rq4", "INBOX"],
    ]]);
    await conn.query("INSERT INTO institutional_requests (id, organization_id, destination_domain, status) VALUES ?", [[
      ["r9r-a1", ORG_A, "parecer_juridico", "PENDING"], ["r9r-a2", ORG_A, "parecer_juridico", "COMPLETED"],
      ["r9r-a3", ORG_A, "contratos", "PENDING"],
    ]]);

    await conn.query("INSERT INTO operation_records (id, organization_id, record_type, number, current_stage, event_date, event_end_date) VALUES ?", [[
      ["r9o-a-late", ORG_A, "processo_licitatorio_legado", "OL-1", "Em andamento", "2026-09-01", "2026-09-10"],
      ["r9o-a-final", ORG_A, "processo_licitatorio_legado", "OL-2", "Finalizado", "2026-09-01", ""],
      ["r9o-a-future", ORG_A, "processo_licitatorio_legado", "OL-3", "Em andamento", "2026-10-15", ""],
    ]]);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.end();
  });

  it("contratos vencendo = contratos DISTINTOS na janela de 30 dias, sem encerrados nem prorrogados", async () => {
    const [[raw]] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM operational_events WHERE organization_id = ? AND event_type = 'vencimento_contrato' AND event_date >= ?",
      [ORG_A, TODAY]);
    expect(Number(raw.n)).toBe(20); // a contagem antiga (eventos ≥ hoje, sem janela) daria 20
    const a = await getDashboard({ organizationId: ORG_A, today: TODAY });
    expect(a.indicators.contractsExpiring).toBe(3); // r9c-a1, r9c-a4 (fronteira +30), r9c-a7 (hoje)
    const b = await getDashboard({ organizationId: ORG_B, today: TODAY });
    expect(b.indicators.contractsExpiring).toBe(1);
  }, 60_000);

  it("tarefas pendentes, processos ativos/concluídos e filas contadas por tenant sem truncamento", async () => {
    const { indicators } = await getDashboard({ organizationId: ORG_A, today: TODAY });
    expect(indicators.pendingTasks).toBe(3);
    expect(indicators.activeProcesses).toBe(206);    // 205 em andamento + contratação direta em publicação
    expect(indicators.concludedProcesses).toBe(3);   // 2 emitidos + 1 contratação concluída; arquivados fora
    expect(indicators.activeContracts).toBe(4);      // a1, a3, a5, a6 (rescindido fora)
    expect(indicators.legalOpinionsAwaiting).toBe(2);
    expect(indicators.pendingRequests).toBe(1);
    expect(indicators.trackedRecords).toBe(3);
    expect(indicators.finalizedRecords).toBe(1);
    const b = await getDashboard({ organizationId: ORG_B, today: TODAY });
    expect(b.indicators.pendingTasks).toBe(1);
    expect(b.indicators.concludedProcesses).toBe(1);
    expect(b.indicators.activeProcesses).toBe(0);
  }, 60_000);

  it("painel: atrasado aparece; arquivados fora; publicação não é concluída", async () => {
    const rows = await getMonitoringPanel({ organizationId: ORG_A, today: TODAY });
    const by = (id: string) => rows.find((r) => r.processId === id);
    expect(by("r9o-a-late")?.situation).toBe("vermelho");
    expect(by("r9o-a-final")?.situation).toBe("verde");
    expect(by("r9o-a-future")?.situation).toBe("azul");
    expect(by("r9d-a-arch")).toBeUndefined();
    expect(by("r9d-a-pub")?.situation).not.toBe("verde");
    expect(by("r9d-a-done")?.situation).toBe("verde");
  }, 60_000);

  it("recomendação de vencimento usa a mesma contagem de contratos", async () => {
    const recs = await getRecommendations({ organizationId: ORG_A, today: TODAY });
    expect(recs.find((r) => r.kind === "vencimento")?.title).toBe("3 contrato(s) com vencimento próximo");
  }, 60_000);
});
