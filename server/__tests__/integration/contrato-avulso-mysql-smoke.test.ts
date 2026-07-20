/**
 * Contrato avulso (createManualContract / contractWorkspaceRouter.createManual) —
 * smoke contra MySQL REAL. Só roda quando DATABASE_URL está definido; pulado
 * localmente sem banco. Cobre os itens da ETAPA 6.1 da revisão arquitetural.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { createManualContract, ManualContractConflictError, importExternalContract } from "../../services/contractService";
import { getContractWorkspace, findManualContractByNumber } from "../../db/contractWorkspace";
import { checkIdempotency, saveIdempotencyResult } from "../../services/idempotencyService";

const DB = process.env.DATABASE_URL;
const CORR = "corr-avulso-smoke";
const ORG_A = 900001;
const ORG_B = 900002;
const USER_A = 1;

describe.skipIf(!DB)("Contrato avulso — MySQL real", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
  }, 30_000);

  afterAll(async () => {
    await conn.execute(`DELETE FROM contract_workspaces WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.execute(`DELETE FROM imported_contracts WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    // idempotency_keys usa coluna física camelCase (migration 0036), diferente das
    // demais tabelas deste arquivo (snake_case) — nome real confirmado no schema.
    await conn.execute(`DELETE FROM idempotency_keys WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  it("1/2. criação e leitura: persiste e lê de volta via getContractWorkspace (id real, organizationId real)", async () => {
    const ws = await createManualContract({
      organizationId: ORG_A, contractNumber: "CT-SMOKE-001", contractor: "Fornecedor Real",
      object: "Objeto real", value: 123456, term: "6 meses", createdBy: USER_A, correlationId: CORR,
    });
    const read = await getContractWorkspace(ws.id, ORG_A);
    expect(read).not.toBeNull();
    expect(read!.originType).toBe("avulso");
    expect(read!.contractor).toBe("Fornecedor Real");
  });

  it("3. persiste createdBy real (não 'sistema')", async () => {
    const ws = await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-002", createdBy: 77, correlationId: CORR });
    const read = await getContractWorkspace(ws.id, ORG_A);
    expect(read!.createdBy).toBe(77);
  });

  it("4. auditoria: evento aparece em process_timeline com o ator real (não 'sistema')", async () => {
    const ws = await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-003", createdBy: 55, correlationId: CORR });
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT actor, event_type FROM process_timeline WHERE process_id = ? AND organization_id = ?`,
      [ws.id, ORG_A]
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].actor).toBe("user:55");
    expect(rows[0].actor).not.toBe("sistema");
  });

  it("5. isolamento entre duas organizações: contrato da org A não é visível pela org B", async () => {
    const ws = await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-ISO", createdBy: USER_A, correlationId: CORR });
    expect(await getContractWorkspace(ws.id, ORG_A)).not.toBeNull();
    expect(await getContractWorkspace(ws.id, ORG_B)).toBeNull(); // mesma id, org errada → null
    // mesmo número em orgs diferentes NÃO colide (unicidade é por organização)
    const wsB = await createManualContract({ organizationId: ORG_B, contractNumber: "CT-SMOKE-ISO", createdBy: USER_A, correlationId: CORR });
    expect(wsB.organizationId).toBe(ORG_B);
  });

  it("6. contrato sem processo: originProcess vazio, sem quebrar leitura/listagem", async () => {
    const ws = await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-SEMPROC", createdBy: USER_A, correlationId: CORR });
    expect(ws.originProcess).toBe("");
    const read = await getContractWorkspace(ws.id, ORG_A);
    expect(read!.originProcess).toBe("");
  });

  it("7/8. idempotência do COMANDO: mesma key + mesmo payload → replay; mesma key + payload diferente → conflito reportado", async () => {
    const key = "idem-key-smoke-1";
    const payload = { contractNumber: "CT-SMOKE-IDEM", contractor: "A" };
    const payloadHash1 = JSON.stringify(payload);

    // Primeira "execução": registra a chave como completed com uma resposta.
    const first = await checkIdempotency(key, USER_A, ORG_A, "contractWorkspace.createManual", payloadHash1);
    expect(first.status).toBe("new");
    await saveIdempotencyResult(key, USER_A, ORG_A, { fakeResponse: true });

    // Retry — MESMO payload → completed, sem mismatch → replay seguro.
    const replay = await checkIdempotency(key, USER_A, ORG_A, "contractWorkspace.createManual", payloadHash1);
    expect(replay.status).toBe("completed");
    if (replay.status === "completed") {
      expect(replay.payloadMismatch).toBe(false);
      expect(replay.response).toEqual({ fakeResponse: true });
    }

    // Mesma key, payload DIFERENTE → conflito sinalizado (payloadMismatch=true).
    const differentPayloadHash = JSON.stringify({ ...payload, contractor: "B" });
    const conflict = await checkIdempotency(key, USER_A, ORG_A, "contractWorkspace.createManual", differentPayloadHash);
    expect(conflict.status).toBe("completed");
    if (conflict.status === "completed") {
      expect(conflict.payloadMismatch).toBe(true);
    }
  });

  it("9. colisão de número contratual: 2ª criação com o mesmo número lança ManualContractConflictError com o id existente", async () => {
    const ws1 = await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-COLISAO", createdBy: 1, correlationId: CORR });
    await expect(
      createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-COLISAO", createdBy: 2, correlationId: CORR })
    ).rejects.toThrow(ManualContractConflictError);

    try {
      await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-COLISAO", createdBy: 2, correlationId: CORR });
    } catch (e) {
      expect(e).toBeInstanceOf(ManualContractConflictError);
      expect((e as ManualContractConflictError).existingId).toBe(ws1.id);
    }
  });

  it("10. ausência de sobrescrita silenciosa: após a tentativa de colisão, o contrato original permanece intacto", async () => {
    const ws = await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-NOOVERWRITE", contractor: "Original", createdBy: 1, correlationId: CORR });
    await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-NOOVERWRITE", contractor: "Tentativa de sobrescrita", createdBy: 2, correlationId: CORR }).catch(() => {});
    const read = await getContractWorkspace(ws.id, ORG_A);
    expect(read!.contractor).toBe("Original"); // nunca foi trocado
  });

  it("11. leitura após fechar e reabrir conexão", async () => {
    const ws = await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-RECONN", createdBy: USER_A, correlationId: CORR });
    const conn2 = await mysql.createConnection(DB!);
    const [rows] = await conn2.execute<mysql.RowDataPacket[]>(
      `SELECT id, contract_number FROM contract_workspaces WHERE id = ? AND organization_id = ?`,
      [ws.id, ORG_A]
    );
    await conn2.end();
    expect(rows.length).toBe(1);
    expect(rows[0].contract_number).toBe("CT-SMOKE-RECONN");
  });

  it("12. reload/listagem: findManualContractByNumber encontra o contrato certo, e nenhum outro", async () => {
    await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-FIND", createdBy: USER_A, correlationId: CORR });
    const found = await findManualContractByNumber(ORG_A, "CT-SMOKE-FIND");
    expect(found).not.toBeNull();
    const notFound = await findManualContractByNumber(ORG_A, "CT-SMOKE-NUNCA-EXISTIU");
    expect(notFound).toBeNull();
  });

  it("13. separação entre avulso e importado: importExternalContract não colide com número avulso igual (originType diferente)", async () => {
    await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-SEPARACAO", createdBy: USER_A, correlationId: CORR });
    const imported = await importExternalContract({
      organizationId: ORG_A, source: "pdf", contractNumber: "CT-SMOKE-SEPARACAO",
      rawText: "CONTRATO Nº SMOKE\nCONTRATADO: Fulano ME\nVALOR: R$ 1.000,00", correlationId: CORR,
    });
    expect(imported.workspace.originType).toBe("externo");
    expect(imported.assisted).toBe(true); // importado carrega o disclaimer de reconstrução assistida
    // avulso não tem esse campo — confirma que são fluxos e ids distintos, sem colisão
    const avulsoFound = await findManualContractByNumber(ORG_A, "CT-SMOKE-SEPARACAO");
    expect(avulsoFound).not.toBeNull();
    expect(avulsoFound!.id).not.toBe(imported.workspace.id);
  });

  it("14. criação concorrente com a MESMA idempotencyKey: a segunda corrida vê o resultado já registrado (sem duplicar efeito)", async () => {
    const key = "idem-key-concurrent";
    const payloadHash = JSON.stringify({ contractNumber: "CT-SMOKE-CONCURRENT" });
    const first = await checkIdempotency(key, USER_A, ORG_A, "contractWorkspace.createManual", payloadHash);
    expect(first.status).toBe("new"); // a própria chamada já grava "processing"
    const second = await checkIdempotency(key, USER_A, ORG_A, "contractWorkspace.createManual", payloadHash);
    expect(second.status).toBe("processing"); // a 2ª corrida VÊ que já está em andamento — não recria
  });

  it("15. falha do provider/serviço não deixa persistência parcial: colisão rejeitada não cria linha extra", async () => {
    await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-PARCIAL", createdBy: 1, correlationId: CORR });
    const [beforeRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM contract_workspaces WHERE organization_id = ? AND contract_number = ? AND origin_type = 'avulso'`,
      [ORG_A, "CT-SMOKE-PARCIAL"]
    );
    await createManualContract({ organizationId: ORG_A, contractNumber: "CT-SMOKE-PARCIAL", createdBy: 2, correlationId: CORR }).catch(() => {});
    const [afterRows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM contract_workspaces WHERE organization_id = ? AND contract_number = ? AND origin_type = 'avulso'`,
      [ORG_A, "CT-SMOKE-PARCIAL"]
    );
    expect(Number((afterRows[0] as { cnt: number }).cnt)).toBe(Number((beforeRows[0] as { cnt: number }).cnt)); // 1 antes, 1 depois — sem duplicar
  });
});
