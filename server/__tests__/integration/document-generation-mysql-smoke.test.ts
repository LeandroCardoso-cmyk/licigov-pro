/**
 * Geração documental (documentsRouter.generateDocument) — smoke contra MySQL REAL.
 *
 * Só roda quando DATABASE_URL está definido; pulado localmente sem banco. O SDK do
 * Gemini é mockado (não é persistência, é uma chamada de rede externa) — mas a
 * PERSISTÊNCIA e o VERSIONAMENTO são exercitados contra o MySQL real, não contra
 * `db` mockado (diferente de documents.test.ts, que mocka todo o módulo `db`).
 *
 * Cobre exatamente os itens da ETAPA 6.2:
 *  - ETP versão 1 (processo sem documento);
 *  - ETP versão 2 quando já existe (preserva a v1);
 *  - resposta vazia rejeitada, sem persistir documento parcial;
 *  - provider falhando sem persistência parcial.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;

// Mock do SDK: cada teste controla o próximo retorno via `nextResponse`.
type MockBehavior = { text: string } | { throwError: Error };
let nextBehavior: MockBehavior = { text: "# Estudo Técnico Preliminar\n\nConteúdo real gerado." };

vi.mock("@google/generative-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/generative-ai")>();
  return {
    ...actual,
    GoogleGenerativeAI: class {
      getGenerativeModel() {
        return {
          generateContent: async () => {
            if ("throwError" in nextBehavior) throw nextBehavior.throwError;
            return { response: { candidates: [{}], text: () => nextBehavior.text } };
          },
        };
      }
    },
  };
});

describe.skipIf(!DB)("Geração documental — MySQL real (documentsRouter.generateDocument)", () => {
  let conn: mysql.Connection;
  let userId: number;
  let processId: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    const [userResult] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
      [`test-doc-gen-${Date.now()}`, "Usuário de Teste", `doc-gen-${Date.now()}@teste.local`]
    );
    userId = userResult.insertId;

    const [procResult] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO processes (name, object, ownerId) VALUES (?, ?, ?)`,
      ["Processo de Teste — Geração Documental", "Objeto de teste", userId]
    );
    processId = procResult.insertId;
  }, 60_000);

  afterAll(async () => {
    if (conn) {
      await conn.execute(`DELETE FROM documents WHERE processId = ?`, [processId]).catch(() => {});
      await conn.execute(`DELETE FROM processes WHERE id = ?`, [processId]).catch(() => {});
      await conn.execute(`DELETE FROM users WHERE id = ?`, [userId]).catch(() => {});
      await conn.end();
    }
  });

  async function callGenerate(docType: "etp") {
    const { appRouter } = await import("../../routers");
    const caller = appRouter.createCaller({
      user: { id: userId, role: "user" } as any,
      req: {} as any,
      res: {} as any,
      correlationId: "test-doc-gen",
    } as any);
    return caller.documents.generateDocument({ processId, docType });
  }

  async function countDocuments(): Promise<number> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM documents WHERE processId = ? AND type = 'etp'`,
      [processId]
    );
    return Number((rows[0] as { cnt: number }).cnt);
  }

  it("ETP versão 1: processo sem documento → cria a primeira versão", async () => {
    nextBehavior = { text: "# ETP v1\n\nConteúdo real da primeira versão." };
    const result = await callGenerate("etp");
    expect(result.version).toBe(1);
    expect(await countDocuments()).toBe(1);
  }, 30_000);

  it("ETP versão 2: processo que JÁ TINHA ETP → cria nova versão, preserva a v1", async () => {
    nextBehavior = { text: "# ETP v2\n\nConteúdo real da segunda versão." };
    const result = await callGenerate("etp");
    expect(result.version).toBe(2);
    expect(await countDocuments()).toBe(2); // v1 + v2, ambas presentes — sem overwrite

    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT version, content FROM documents WHERE processId = ? AND type = 'etp' ORDER BY version`,
      [processId]
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(String(rows[0].content)).toContain("primeira versão");
    expect(String(rows[1].content)).toContain("segunda versão");
  }, 30_000);

  it("resposta vazia do provider é REJEITADA — não persiste documento parcial (continua em 2)", async () => {
    nextBehavior = { text: "   " }; // só espaços — equivalente a vazio
    await expect(callGenerate("etp")).rejects.toThrow();
    expect(await countDocuments()).toBe(2); // nenhuma v3 "vazia" foi criada
  }, 30_000);

  it("falha do provider é REJEITADA — não persiste documento parcial (continua em 2)", async () => {
    nextBehavior = { throwError: Object.assign(new Error("503 Service Unavailable"), { status: 503 }) };
    await expect(callGenerate("etp")).rejects.toThrow();
    expect(await countDocuments()).toBe(2); // nenhuma v3 "parcial" foi criada
  }, 30_000);
});
