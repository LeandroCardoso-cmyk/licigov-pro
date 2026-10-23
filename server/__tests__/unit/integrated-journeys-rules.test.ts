/**
 * LICIGOV-FAST — regras puras das jornadas integradas: vigência só para contrato/aditivo/ata; indicador de vencimento conta
 * contratos (não alertas) numa janela de 90 dias; retry da criação converge só para o MESMO estado de nascimento.
 */
import { describe, it, expect } from "vitest";
import { expirationKindFor } from "@shared/operationRecordExpiration";
import { createExpirationEvents } from "../../domain/operationalEvent";
import { expiringContractRefs, EXPIRING_WINDOW_DAYS } from "../../services/departmentOperationService";
import { createContractWorkspace } from "../../domain/contractWorkspace";
import { isSameContractCreate } from "../../domain/contractCreation";

describe("vigência de registros operacionais", () => {
  it("só contrato/aditivo/ata externos têm término de vigência", () => {
    expect(expirationKindFor("contrato_externo")).toBe("contrato");
    expect(expirationKindFor("aditivo_externo")).toBe("aditivo");
    expect(expirationKindFor("ata_externa")).toBe("ata");
    for (const t of ["processo_licitatorio_legado", "contratacao_direta_legada", "parecer_externo", "reuniao", "evento", "tarefa", "outro"]) {
      expect(expirationKindFor(t), t).toBeNull();
    }
  });
});

describe("indicador de contratos vencendo", () => {
  const today = "2026-10-14";
  const events = (ref: string, date: string) => createExpirationEvents({ organizationId: 1, kind: "contrato", referenceId: ref, title: ref, expirationDate: date, correlationId: "c" });

  it("conta cada contrato UMA vez, mesmo com os 5 alertas do mesmo vencimento", () => {
    const evs = [...events("a", "2026-11-01"), ...events("b", "2026-12-01")];
    expect(evs).toHaveLength(12);
    expect([...expiringContractRefs(evs, today)].sort()).toEqual(["a", "b"]);
  });

  it(`janela de ${EXPIRING_WINDOW_DAYS} dias: vencido ou distante não conta; aditivo/ata não contam como contrato`, () => {
    const evs = [
      ...events("vencido", "2026-10-13"), ...events("hoje", today), ...events("limite", "2027-01-12"), ...events("distante", "2027-01-13"),
      ...createExpirationEvents({ organizationId: 1, kind: "aditivo", referenceId: "ad", title: "ad", expirationDate: "2026-11-01", correlationId: "c" }),
    ];
    expect([...expiringContractRefs(evs, today)].sort()).toEqual(["hoje", "limite"]);
  });
});

describe("retry idempotente da criação de contrato", () => {
  const base = { organizationId: 1, contractNumber: "CT-1", contractor: "F", object: "O", term: "12 meses", correlationId: "c", createdBy: 7 };

  it("legado nasce vigente e converge com o mesmo registro vigente", () => {
    const c = createContractWorkspace({ ...base, originType: "legado", status: "vigente" });
    expect(isSameContractCreate({ ...c }, c)).toBe(true);
  });

  it("contrato já aditado (estado posterior ao nascimento) nunca converge", () => {
    const c = createContractWorkspace({ ...base, originType: "legado", status: "vigente" });
    expect(isSameContractCreate({ ...c, status: "aditado" }, c)).toBe(false);
  });

  it("minuta continua exigindo minuta (comportamento anterior inalterado)", () => {
    const c = createContractWorkspace({ ...base, originType: "avulso", status: "minuta" });
    expect(isSameContractCreate({ ...c }, c)).toBe(true);
    expect(isSameContractCreate({ ...c, status: "vigente" }, c)).toBe(false);
  });
});
