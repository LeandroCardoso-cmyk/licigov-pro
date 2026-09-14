/**
 * A3-RD1 — CLI governado de APROVAÇÃO/ATIVAÇÃO de reference set (boundary operacional do owner).
 *
 * Cobre (spec):
 *   1-4. ausência de expected-hash / actor / approval-source / correlation-id → rejeita ANTES do domínio;
 *   5. hash incorreto → fail-closed (domínio lança CONTENT_HASH_INVALID);
 *   6. set inexistente → fail-closed; 7. set incompleto → fail-closed;
 *   8. aprovação válida chama EXATAMENTE uma vez o domínio com todos os campos;
 *   9. logs não expõem DATABASE_URL; 10. nenhuma migration/installer é chamada;
 *   11. nenhuma ativação ocorre no import do módulo.
 * Além disso: sem flag --force (bypass proibido) e comando canônico presente no package.json.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

// Mocka o domínio para provar (a) que o import do CLI não ativa nada e (b) contagem de chamadas.
const approveMock = vi.hoisted(() => vi.fn());
vi.mock("../../db/legalReference", () => ({ approveAndActivateReferenceSet: approveMock }));

import { parseApproveArgs, runApprove } from "../../../scripts/approve-legal-reference-set";

const VALID_HASH = "a".repeat(64);
const baseArgv = [
  "--version", "1",
  "--expected-hash", VALID_HASH,
  "--actor-user-id", "7",
  "--approval-source", "owner-cli",
  "--correlation-id", "corr-1",
];

beforeEach(() => approveMock.mockReset());

describe("A3-RD1 — parseApproveArgs (fail-closed antes do domínio)", () => {
  it("parseia todos os campos obrigatórios + opcionais", () => {
    const a = parseApproveArgs([...baseArgv, "--actor-role", "platform_admin"]);
    expect(a).toMatchObject({
      version: 1, expectedReferenceHash: VALID_HASH, actorUserId: 7,
      approvalSource: "owner-cli", correlationId: "corr-1", actorRole: "platform_admin",
    });
  });

  it("1. ausência de expected-hash → rejeita", () => {
    expect(() => parseApproveArgs(["--version","1","--actor-user-id","7","--approval-source","s","--correlation-id","c"]))
      .toThrow(/--expected-hash/);
  });
  it("2. ausência de actor → rejeita", () => {
    expect(() => parseApproveArgs(["--version","1","--expected-hash",VALID_HASH,"--approval-source","s","--correlation-id","c"]))
      .toThrow(/--actor-user-id/);
  });
  it("3. ausência de approval-source → rejeita", () => {
    expect(() => parseApproveArgs(["--version","1","--expected-hash",VALID_HASH,"--actor-user-id","7","--correlation-id","c"]))
      .toThrow(/--approval-source/);
  });
  it("4. ausência de correlation-id → rejeita", () => {
    expect(() => parseApproveArgs(["--version","1","--expected-hash",VALID_HASH,"--actor-user-id","7","--approval-source","s"]))
      .toThrow(/--correlation-id/);
  });
  it("hash com forma inválida → rejeita (sem bypass)", () => {
    expect(() => parseApproveArgs(["--version","1","--expected-hash","wrong","--actor-user-id","7","--approval-source","s","--correlation-id","c"]))
      .toThrow(/SHA-256/);
  });
  it("--force é proibido (sem bypass de hash)", () => {
    expect(() => parseApproveArgs([...baseArgv, "--force"])).toThrow(/force não é permitida/i);
  });
  it("version/actor não-inteiro → rejeita", () => {
    expect(() => parseApproveArgs(["--version","x","--expected-hash",VALID_HASH,"--actor-user-id","7","--approval-source","s","--correlation-id","c"]))
      .toThrow(/--version/);
  });
});

describe("A3-RD1 — runApprove (chama SOMENTE o domínio, fail-closed)", () => {
  it("8. aprovação válida → chama o domínio EXATAMENTE uma vez com todos os campos", async () => {
    const approve = vi.fn(async () => ({ setId: 5, activated: true as const }));
    const args = parseApproveArgs([...baseArgv, "--actor-role", "platform_admin"]);
    const r = await runApprove(args, { approve: approve as never, log: () => {} });
    expect(r).toEqual({ setId: 5, activated: true });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith({
      version: 1, expectedReferenceHash: VALID_HASH, actorUserId: 7,
      approvalSource: "owner-cli", correlationId: "corr-1", actorRole: "platform_admin",
      law: undefined, jurisdiction: undefined,
    });
  });

  it("5. hash incorreto → fail-closed (propaga CONTENT_HASH_INVALID)", async () => {
    const approve = vi.fn(async () => { throw new Error("LEGAL_REFERENCE_CONTENT_HASH_INVALID"); });
    const args = parseApproveArgs(baseArgv);
    await expect(runApprove(args, { approve: approve as never, log: () => {} })).rejects.toThrow(/CONTENT_HASH_INVALID/);
  });

  it("6. set inexistente → fail-closed", async () => {
    const approve = vi.fn(async () => { throw new Error("LEGAL_REFERENCE_SET_MISSING"); });
    const args = parseApproveArgs(baseArgv);
    await expect(runApprove(args, { approve: approve as never, log: () => {} })).rejects.toThrow(/SET_MISSING/);
  });

  it("7. set incompleto → fail-closed", async () => {
    const approve = vi.fn(async () => { throw new Error("LEGAL_REFERENCE_EMPTY"); });
    const args = parseApproveArgs(baseArgv);
    await expect(runApprove(args, { approve: approve as never, log: () => {} })).rejects.toThrow(/EMPTY/);
  });

  it("9. logs não expõem segredo (sanitizados) e hash é abreviado", async () => {
    const approve = vi.fn(async () => ({ setId: 5, activated: true as const }));
    const logs: string[] = [];
    const args = parseApproveArgs(baseArgv);
    await runApprove(args, { approve: approve as never, log: (m) => logs.push(m) });
    const joined = logs.join("\n");
    expect(joined).not.toContain("DATABASE_URL");
    expect(joined).not.toContain(VALID_HASH); // hash completo nunca logado
    expect(joined).toMatch(/setId=5/);
    expect(joined).toMatch(/status=active/);
  });
});

describe("A3-RD1 — contrato de segurança do CLI (source + import)", () => {
  it("11. importar o módulo NÃO ativa nada (domínio não chamado no import)", () => {
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("10. o CLI não migra, não instala e chama só o domínio de aprovação", () => {
    const src = read("scripts/approve-legal-reference-set.ts");
    expect(src).toContain("approveAndActivateReferenceSet");
    expect(src).not.toMatch(/migrate-release|install-reference-data|installGovernedLegalReferenceV1|migrateWithAdvisoryLock/);
    expect(src).toMatch(/force não é permitida/); // --force é REJEITADO (nunca aceito como bypass)
    // Nunca loga o valor da DATABASE_URL (apenas a ausência).
    expect(src).not.toMatch(/console\.[a-z]+\([^)]*databaseUrl/);
  });

  it("comando canônico presente e apontando para o CLI", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:reference:approve"]).toBe("tsx scripts/approve-legal-reference-set.ts");
  });
});
