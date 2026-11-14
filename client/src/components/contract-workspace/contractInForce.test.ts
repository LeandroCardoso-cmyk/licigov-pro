/**
 * M8 pós-homologação — indicadores de contratos: "Vigentes" (lista) conta contratos EM VIGOR (vigente, aditado, apostilado);
 * o painel operacional conta "em andamento" (não concluídos, inclusive minutas). Conceitos distintos, rótulos que os dizem.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CONTRACT_IN_FORCE_STATUSES, isContractInForce } from "@shared/contractStatus";

describe("isContractInForce", () => {
  it("vigente, aditado e apostilado vigem; minuta ainda não; encerrado/rescindido/arquivado não mais", () => {
    expect([...CONTRACT_IN_FORCE_STATUSES]).toEqual(["vigente", "aditado", "apostilado"]);
    for (const s of ["vigente", "aditado", "apostilado"]) expect(isContractInForce(s)).toBe(true);
    for (const s of ["minuta", "encerrado", "rescindido", "arquivado", "", null, undefined]) expect(isContractInForce(s)).toBe(false);
  });
  it("homologação: 3 contratos legados aditados ⇒ 3 vigentes (antes: 0)", () => {
    const contracts = [{ status: "aditado" }, { status: "aditado" }, { status: "aditado" }, { status: "minuta" }];
    expect(contracts.filter((c) => isContractInForce(c.status)).length).toBe(3);
  });
  it("a lista usa o helper compartilhado e o painel rotula 'em andamento'", () => {
    const overview = fs.readFileSync(path.join(__dirname, "ContractOverview.tsx"), "utf8");
    expect(overview).toContain("contracts.filter((c) => isContractInForce(c.status))");
    const indicators = fs.readFileSync(path.join(__dirname, "../department-operation/OperationalIndicators.tsx"), "utf8");
    expect(indicators).toContain('{ key: "activeContracts", label: "Contratos em andamento" }');
  });
  it("linhas da lista são acessíveis por teclado (Enter/Espaço) quando abrem o contrato", () => {
    const overview = fs.readFileSync(path.join(__dirname, "ContractOverview.tsx"), "utf8");
    expect(overview).toContain('tabIndex: 0, role: "button"');
    expect(overview).toContain('e.key === "Enter" || e.key === " "');
  });
});
