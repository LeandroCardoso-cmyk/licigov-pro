/**
 * NEW-022 — contrato do bloqueio da ativação genérica, sem banco (roda em todo CI).
 *
 *  - predicado puro: só `minuta → vigente` é ativação;
 *  - o guard só lê o contrato quando o pedido traz `status: "vigente"`; recusa FORBIDDEN com token estável;
 *    contrato inexistente/de outro órgão ⇒ NOT_FOUND neutro; nunca escreve;
 *  - freeze estático: no handler `updateContract`, o guard roda ANTES de qualquer leitura de campos,
 *    transição ou escrita.
 * A prova com banco real está em `new022-generic-contract-activation-mysql-smoke.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../db/contractWorkspace", () => ({ getContractWorkspace: vi.fn() }));

import { getContractWorkspace } from "../../db/contractWorkspace";
import {
  assertNoGenericContractActivation,
  isGenericContractActivation,
  CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION,
  CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION_MESSAGE,
} from "../../services/contractActivationGuard";

const STATUSES = ["minuta", "vigente", "aditado", "apostilado", "encerrado", "rescindido", "arquivado"] as const;
const getWs = () => vi.mocked(getContractWorkspace);
const ws = (status: string) => ({ id: "c1", organizationId: 7, status } as never);

beforeEach(() => { vi.clearAllMocks(); });

describe("NEW-022 — predicado puro", () => {
  it("apenas minuta → vigente é ativação", () => {
    for (const from of STATUSES) for (const to of STATUSES) {
      expect(isGenericContractActivation(from, to)).toBe(from === "minuta" && to === "vigente");
    }
    expect(isGenericContractActivation("minuta", undefined)).toBe(false);
    expect(isGenericContractActivation("minuta", null)).toBe(false);
  });
});

describe("NEW-022 — assertNoGenericContractActivation", () => {
  it("sem status ou status ≠ vigente ⇒ nem lê o contrato", async () => {
    for (const status of [undefined, null, "encerrado", "arquivado", "minuta"]) {
      await expect(assertNoGenericContractActivation({ contractId: "c1", status }, 7)).resolves.toBeUndefined();
    }
    expect(getWs()).not.toHaveBeenCalled();
  });

  it("minuta + status vigente ⇒ FORBIDDEN com token estável (mensagem idêntica)", async () => {
    getWs().mockResolvedValue(ws("minuta"));
    const err = await assertNoGenericContractActivation({ contractId: "c1", status: "vigente" }, 7, { user: { id: 3 }, correlationId: "k" }).catch((e) => e);
    expect(err).toMatchObject({ code: "FORBIDDEN", message: CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION_MESSAGE });
    expect(err.message).toContain(CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION);
    expect(getWs()).toHaveBeenCalledWith("c1", 7); // leitura escopada ao órgão do contexto
  });

  it("status vigente a partir de aditado/apostilado/vigente não é ativação ⇒ segue para a máquina", async () => {
    for (const from of ["aditado", "apostilado", "vigente", "encerrado", "arquivado"]) {
      getWs().mockResolvedValueOnce(ws(from));
      await expect(assertNoGenericContractActivation({ contractId: "c1", status: "vigente" }, 7)).resolves.toBeUndefined();
    }
  });

  it("contrato inexistente/de outro órgão ⇒ NOT_FOUND neutro (mesma mensagem do handler)", async () => {
    getWs().mockResolvedValue(null);
    await expect(assertNoGenericContractActivation({ contractId: "x", status: "vigente" }, 7))
      .rejects.toMatchObject({ code: "NOT_FOUND", message: "Contrato não encontrado nesta organização." });
  });
});

describe("NEW-022 — freeze estático do handler updateContract", () => {
  const src = readFileSync(join(__dirname, "..", "..", "routers", "contractWorkspaceRouter.ts"), "utf8");
  const handler = src.split("updateContract:")[1].split("\n    }),")[0];

  it("o guard é a primeira ação do handler: antes de requireContract, transição e escrita", () => {
    const iGuard = handler.indexOf("await assertNoGenericContractActivation(input, orgId, ctx)");
    expect(iGuard).toBeGreaterThan(0);
    for (const later of ["requireContract(", "transitionContractStatus(", "updateContractFields("]) {
      const i = handler.indexOf(later);
      expect(i, later).toBeGreaterThan(iGuard);
    }
    const body = handler.split("=> {")[1];
    const firstStatements = body.trim().split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 2);
    expect(firstStatements[0]).toBe("const orgId = ctx.organizationId!;");
    expect(firstStatements[1].startsWith("await assertNoGenericContractActivation(input, orgId, ctx);")).toBe(true);
  });
});
