/**
 * PR D / DATA-012 — Contrato transacional do Document Version Service.
 *
 * Prova (com o `db.transaction` mockado) que a criação de versão e a restauração são ATÔMICAS:
 * usam UMA transação, propagam falha (rollback) sem estado parcial, e propagam o correlationId.
 * A serialização real da numeração sob concorrência (FOR UPDATE) é exercida pelos smokes MySQL
 * em CI; aqui garantimos o contrato de atomicidade de forma determinística e sem banco.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "../../db/connection";
import { createVersion, restoreToVersion } from "../../services/documentVersionService";
import type { TrpcAuditCtx } from "../../services/activityLogService";

const getDbMock = vi.mocked(getDb);

const capturedInserts: Record<string, unknown>[] = [];
const capturedUpdates: Record<string, unknown>[] = [];

/**
 * Builder encadeável e "thenable": todo método retorna o próprio builder; cada `await` consome
 * o próximo resultado da fila (na ordem exata em que o código aguarda). Um resultado `Error`
 * faz o await rejeitar (simula falha no meio da transação → rollback).
 */
function makeTx(results: unknown[]) {
  let i = 0;
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ["select", "from", "where", "for", "limit", "orderBy", "insert", "$returningId", "update", "onDuplicateKeyUpdate"]) {
    b[m] = vi.fn(chain);
  }
  b.values = vi.fn((v: Record<string, unknown>) => { capturedInserts.push(v); return b; });
  b.set = vi.fn((v: Record<string, unknown>) => { capturedUpdates.push(v); return b; });
  (b as { then: unknown }).then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    const val = results[i++];
    return val instanceof Error ? Promise.reject(val).then(resolve, reject) : Promise.resolve(val).then(resolve, reject);
  };
  return b;
}

function fakeDb(results: unknown[]) {
  const tx = makeTx(results);
  const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx));
  return { transaction } as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>;
}

const ctx: TrpcAuditCtx = {
  user: { id: 42, name: "Fulano", email: "f@x.com" },
  orgMembership: { role: "operator" },
  organizationId: 700001,
  orgName: "Prefeitura",
  correlationId: "corr-xyz",
  requestId: "req-1",
} as unknown as TrpcAuditCtx;

beforeEach(() => {
  capturedInserts.length = 0;
  capturedUpdates.length = 0;
  vi.clearAllMocks();
});

describe("createVersion — atomicidade", () => {
  it("roda dentro de UMA transação, numera MAX+1 e propaga correlationId", async () => {
    const db = fakeDb([
      [],                                   // 1) lock da linha-pai (FOR UPDATE)
      [{ maxVer: 2 }],                      // 2) MAX(versionNumber)
      [{ id: 99 }],                         // 3) insert $returningId
      [{ id: 99, versionNumber: 3, documentId: 1 }], // 4) select final
    ]);
    getDbMock.mockResolvedValue(db);

    const version = await createVersion(
      { documentId: 1, organizationId: 700001, contentSnapshot: "x", correlationId: "corr-xyz" },
      ctx,
    );

    expect(version).toMatchObject({ id: 99, versionNumber: 3 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // versionNumber = MAX(2)+1 = 3 e correlationId propagado ao insert.
    expect(capturedInserts[0]).toMatchObject({ versionNumber: 3, correlationId: "corr-xyz", documentId: 1 });
  });

  it("propaga a falha (rollback) quando o insert falha no meio da transação", async () => {
    const db = fakeDb([
      [],                                   // lock
      [{ maxVer: 0 }],                      // MAX
      new Error("insert falhou"),           // insert rejeita → tx rejeita
    ]);
    getDbMock.mockResolvedValue(db);

    await expect(createVersion(
      { documentId: 1, organizationId: 700001, contentSnapshot: "x" },
      ctx,
    )).rejects.toThrow("insert falhou");
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});

describe("restoreToVersion — atomicidade (versão + ponteiro na mesma transação)", () => {
  it("cria a nova versão e move o ponteiro numa única transação", async () => {
    const db = fakeDb([
      [{ id: 1, version: 5, content: "old", structuredContent: null }], // 1) doc lock
      [{ contentSnapshot: "hist", structuredSnapshot: null, versionNumber: 2 }], // 2) target version
      [],                                   // 3) lock (insertVersionTx)
      [{ maxVer: 5 }],                      // 4) MAX
      [{ id: 77 }],                         // 5) insert $returningId
      [{ id: 77, versionNumber: 6 }],       // 6) select da versão
      [],                                   // 7) update do ponteiro
      [{ id: 1, version: 6, currentVersionId: 77 }], // 8) select final do doc
    ]);
    getDbMock.mockResolvedValue(db);

    const doc = await restoreToVersion(1, 2, ctx);
    expect(doc).toMatchObject({ id: 1, version: 6, currentVersionId: 77 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // o ponteiro foi atualizado para a nova versão, dentro da mesma transação
    expect(capturedUpdates[0]).toMatchObject({ currentVersionId: 77, version: 6 });
  });

  it("faz rollback quando o update do ponteiro falha (sem estado parcial)", async () => {
    const db = fakeDb([
      [{ id: 1, version: 5, content: "old", structuredContent: null }],
      [{ contentSnapshot: "hist", structuredSnapshot: null, versionNumber: 2 }],
      [],
      [{ maxVer: 5 }],
      [{ id: 77 }],
      [{ id: 77, versionNumber: 6 }],
      new Error("update do ponteiro falhou"), // 7) update rejeita → tudo rola para trás
    ]);
    getDbMock.mockResolvedValue(db);

    await expect(restoreToVersion(1, 2, ctx)).rejects.toThrow("update do ponteiro falhou");
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});
