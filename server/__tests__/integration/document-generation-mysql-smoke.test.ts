/**
 * Geração documental LEGADA (documentsRouter.generateDocument) — smoke contra MySQL REAL.
 *
 * R2 / LEG-009 (decisão humana de 27/09/2026 = DISABLE): `documents.generateDocument` foi desligado de forma
 * governada. Este smoke exercitava o caminho feliz legado (ETP v1 → v2, resposta vazia / falha do provider sem
 * persistência parcial) e foi REESCRITO para o contrato governado, preservando a sua intenção central — NENHUMA
 * persistência parcial/indevida:
 *  - toda chamada (qualquer docType, com o SDK do Gemini respondendo, vazio ou falhando) é recusada com
 *    FORBIDDEN + LEGACY_ENDPOINT_DISABLED;
 *  - o SDK do Gemini NUNCA é invocado;
 *  - nenhuma linha nova em `documents` (a v1 pré-existente é preservada intacta), `processes.status` inalterado
 *    e nenhum `activity_logs` gravado.
 * Só roda quando DATABASE_URL está definido; pulado localmente sem banco. A geração oficial de DFD/ETP/TR/Edital
 * é `procurementProcess.*` + Document Engine (coberta pelos smokes canônicos, inalterados).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG = 950091;

// Mock do SDK: cada teste controla o próximo retorno via `nextBehavior`; `sdkCalls` conta invocações reais.
type MockBehavior = { text: string } | { throwError: Error };
let nextBehavior: MockBehavior = { text: "# Estudo Técnico Preliminar\n\nConteúdo real gerado." };
let sdkCalls = 0;

vi.mock("@google/generative-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/generative-ai")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return {
          generateContent: async () => {
            sdkCalls++;
            if ("throwError" in nextBehavior) throw nextBehavior.throwError;
            return { response: { candidates: [{}], text: () => nextBehavior.text } };
          },
        };
      }
    },
  };
});

describe.skipIf(!DB)("Geração documental legada — MySQL real (documents.generateDocument, LEG-009 desativado)", () => {
  let conn: mysql.Connection;
  let userId: number;
  let processId: number;
  let etpV1: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    const stamp = Date.now();
    const [userResult] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
      [`test-doc-gen-${stamp}`, "Usuário de Teste", `doc-gen-${stamp}@teste.local`]
    );
    userId = userResult.insertId;
    await conn.execute(
      `INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`,
      [ORG, userId],
    );

    const [procResult] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, ?, ?, ?, 'em_etp')`,
      [ORG, "Processo de Teste — Geração Documental", "Objeto de teste", userId]
    );
    processId = procResult.insertId;

    // Pré-existente: ETP v1 legado (histórico que DEVE permanecer intacto).
    const [docResult] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO documents (organizationId, processId, type, content, version, createdBy, documentStatus)
       VALUES (?, ?, 'etp', '# ETP v1 — primeira versão', 1, ?, 'draft')`,
      [ORG, processId, userId],
    );
    etpV1 = docResult.insertId;
  }, 60_000);

  afterAll(async () => {
    if (conn) {
      await conn.execute(`DELETE FROM activity_logs WHERE processId = ?`, [processId]).catch(() => {});
      await conn.execute(`DELETE FROM documents WHERE processId = ?`, [processId]).catch(() => {});
      await conn.execute(`DELETE FROM processes WHERE id = ?`, [processId]).catch(() => {});
      await conn.execute(`DELETE FROM organization_members WHERE organizationId = ?`, [ORG]).catch(() => {});
      await conn.execute(`DELETE FROM users WHERE id = ?`, [userId]).catch(() => {});
      await conn.end();
    }
  });

  type LegacyDocType = "dfd" | "etp" | "tr" | "edital" | "contrato" | "ata" | "parecer";
  async function callGenerate(docType: LegacyDocType) {
    const { appRouter } = await import("../../routers");
    const caller = appRouter.createCaller({
      user: { id: userId, role: "user" },
      req: { headers: {} },
      res: {},
      correlationId: "test-doc-gen",
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
    return caller.documents.generateDocument({ processId, docType });
  }

  async function snapshot() {
    const [docs] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, version, content FROM documents WHERE processId = ? ORDER BY id`, [processId],
    );
    const [proc] = await conn.execute<mysql.RowDataPacket[]>(`SELECT status FROM processes WHERE id = ?`, [processId]);
    const [logs] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM activity_logs WHERE processId = ?`, [processId],
    );
    return {
      docs: docs.map((r) => ({ id: Number(r.id), version: Number(r.version), content: String(r.content) })),
      status: String(proc[0].status),
      logs: Number((logs[0] as { cnt: number }).cnt),
    };
  }

  it("ETP (provider respondendo): recusa governada — não cria v2, preserva a v1, não chama o Gemini", async () => {
    nextBehavior = { text: "# ETP v2\n\nConteúdo que NÃO deve ser persistido." };
    const before = await snapshot();
    await expect(callGenerate("etp")).rejects.toMatchObject({
      code: "FORBIDDEN", message: expect.stringContaining("LEGACY_ENDPOINT_DISABLED"),
    });
    const after = await snapshot();
    expect(after).toEqual(before);
    expect(after.docs).toEqual([{ id: etpV1, version: 1, content: "# ETP v1 — primeira versão" }]);
    expect(after.status).toBe("em_etp");
    expect(after.logs).toBe(0);
    expect(sdkCalls).toBe(0);
  }, 30_000);

  it("resposta vazia / falha do provider: a MESMA recusa governada, sem persistência parcial", async () => {
    const before = await snapshot();
    nextBehavior = { text: "   " };
    const empty = await callGenerate("etp").catch((e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));
    nextBehavior = { throwError: Object.assign(new Error("503 Service Unavailable"), { status: 503 }) };
    const failing = await callGenerate("etp").catch((e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));
    expect(empty).toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("LEGACY_ENDPOINT_DISABLED") });
    expect(failing).toEqual(empty);
    expect(await snapshot()).toEqual(before);
    expect(sdkCalls).toBe(0);
  }, 30_000);

  it("todos os 7 docTypes legados são recusados de forma idêntica e nada muda no banco", async () => {
    const before = await snapshot();
    const errors = [];
    for (const t of ["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"] as const) {
      errors.push(await callGenerate(t).catch((e: { code?: string; message?: string }) => ({ code: e.code, message: e.message })));
    }
    expect(errors[0]).toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("LEGACY_ENDPOINT_DISABLED") });
    for (const e of errors) expect(e).toEqual(errors[0]);
    expect(await snapshot()).toEqual(before);
    expect(sdkCalls).toBe(0);
  }, 30_000);
});
