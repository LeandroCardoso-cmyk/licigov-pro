/**
 * NEW-016 — contrato de imutabilidade da versão oficial, sem banco (roda em todo CI).
 *
 *  - GET_LOCK com retorno ≠ 1 (0 = timeout, NULL = erro) ⇒ FALHA FECHADA antes de qualquer leitura/escrita;
 *  - guarda estrutural: nenhuma escrita de `official_documents` usa upsert, e nenhum UPDATE reescreve
 *    `content`/`status`/`metadata` de uma versão existente (append-only).
 * A concorrência real é provada em `new016-official-document-immutability-mysql-smoke.test.ts`.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { createDocument, OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE } from "../../services/officialDocumentLifecycleService";
import { isDuplicateKeyError, OfficialDocumentVersionConflictError, OFFICIAL_DOCUMENT_VERSION_CONFLICT } from "../../db/officialDocuments";

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => null) }));

const PARAMS = {
  organizationId: 1, businessDomain: "processo_licitatorio" as const, documentType: "etp" as const,
  origin: "p1", title: "ETP", content: "X", author: "u", status: "emitido" as const, correlationId: "c",
};

function fakeExecutor(lockValue: unknown) {
  const calls: string[] = [];
  const executor = {
    execute: vi.fn(async (q: unknown) => {
      const text = JSON.stringify(q);
      calls.push(text.includes("RELEASE_LOCK") ? "release" : "get_lock");
      return [[{ ok: lockValue }], []];
    }),
    select: vi.fn(() => { calls.push("select"); throw new Error("não deveria ler sem lock"); }),
    insert: vi.fn(() => { calls.push("insert"); throw new Error("não deveria escrever sem lock"); }),
  };
  return { executor, calls };
}

describe("NEW-016 — GET_LOCK verificado (fail-closed)", () => {
  for (const [label, value] of [["timeout (0)", 0], ["erro (NULL)", null], ["valor inesperado", "2"]] as const) {
    it(`GET_LOCK ${label} ⇒ CONFLICT ${OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE}, zero leitura/escrita, sem RELEASE`, async () => {
      const { executor, calls } = fakeExecutor(value);
      await expect(createDocument(PARAMS, executor as never)).rejects.toMatchObject({
        code: "CONFLICT", message: expect.stringContaining(OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE),
      });
      expect(calls).toEqual(["get_lock"]);
      expect(executor.select).not.toHaveBeenCalled();
      expect(executor.insert).not.toHaveBeenCalled();
    });
  }
});

describe("NEW-016 — erro institucional de colisão", () => {
  it("OfficialDocumentVersionConflictError é CONFLICT com token estável", () => {
    const e = new OfficialDocumentVersionConflictError("A versão 1");
    expect(e.code).toBe("CONFLICT");
    expect(e.message.startsWith(`${OFFICIAL_DOCUMENT_VERSION_CONFLICT}:`)).toBe(true);
  });
  it("isDuplicateKeyError reconhece ER_DUP_ENTRY direto e encapsulado (drizzle `cause`)", () => {
    expect(isDuplicateKeyError({ code: "ER_DUP_ENTRY" })).toBe(true);
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true);
    expect(isDuplicateKeyError({ message: "Failed query", cause: { code: "ER_DUP_ENTRY" } })).toBe(true);
    expect(isDuplicateKeyError({ code: "ER_LOCK_DEADLOCK" })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
  });
});

describe("NEW-016 — guarda estrutural: official_documents é append-only", () => {
  const ROOT = join(__dirname, "..", "..");
  const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

  it("insertOfficialDocument NÃO usa onDuplicateKeyUpdate", () => {
    const body = src("db/officialDocuments.ts").split("export async function insertOfficialDocument")[1].split("\nexport ")[0];
    expect(body).toContain("db.insert(officialDocumentsTable)");
    expect(body).not.toMatch(/onDuplicateKeyUpdate/);
  });

  it("createDocument usa leitura com lock, verifica o GET_LOCK e grava a timeline com INSERT puro", () => {
    const svc = src("services/officialDocumentLifecycleService.ts");
    const persist = svc.split("const persist = async")[1].split("if (executor) return persist")[0];
    expect(persist).toMatch(/if \(acquired !== 1\)/);
    expect(persist).toContain("lockLatestVersionForUpdate(");
    expect(persist).toContain("tx, { locked: true });");
    expect(persist).not.toContain("countVersions(");
  });

  it("nenhum código de servidor faz upsert ou UPDATE de content/status/metadata em official_documents", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (f === "__tests__" || f === "node_modules") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk(ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      // qualquer UPDATE sobre a tabela oficial só pode tocar referências de storage
      for (const m of s.matchAll(/\.update\(officialDocumentsTable\)\s*\.set\(\{([^}]*)\}/g)) {
        if (/\b(content|status|metadata|version|author|replayHash)\b/.test(m[1])) offenders.push(`${f}: update ${m[1].trim()}`);
      }
      for (const m of s.matchAll(/insert\(officialDocumentsTable\)[\s\S]{0,1200}?\);/g)) {
        if (/onDuplicateKeyUpdate/.test(m[0])) offenders.push(`${f}: upsert`);
      }
      if (/UPDATE\s+`?official_documents`?\s+SET/i.test(s)) offenders.push(`${f}: SQL cru UPDATE official_documents`);
    }
    expect(offenders).toEqual([]);
  });
});
