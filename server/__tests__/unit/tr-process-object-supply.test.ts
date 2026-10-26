/**
 * M8 (pós-homologação visual) — "Objeto completo" só deixa de ser pendência do TR quando a fonte autoritativa o supre de fato
 * (o que o Edital usa): TR oficial VIGENTE com `metadata.object`, ou o objeto do processo quando ainda não há TR emitido.
 * TR vigente emitido sem objeto registrado (emissões antigas) ⇒ continua pendente (o Edital exige o parâmetro do TR).
 */
import { describe, it, expect } from "vitest";
import { processObjectPendingReason, processObjectSupply, TR_PARAMS_SUPPLIED_BY_PROCESS_OBJECT } from "../../domain/trStructuredParams";

describe("processObjectSupply", () => {
  it("só o objeto completo é suprido dessa forma", () => {
    expect([...TR_PARAMS_SUPPLIED_BY_PROCESS_OBJECT]).toEqual(["processo.objetoCompleto"]);
  });
  it("TR vigente com objeto ⇒ o valor do TR (não o do processo atual)", () => {
    expect(processObjectSupply("Objeto atual do processo", { version: 2, metadata: { object: " Objeto registrado no TR v2 " } }))
      .toEqual({ source: "tr_oficial", value: "Objeto registrado no TR v2", version: 2 });
  });
  it("TR vigente SEM objeto registrado ⇒ null (nunca presume o objeto do processo)", () => {
    expect(processObjectSupply("Objeto do processo", { version: 1, metadata: {} })).toBeNull();
    expect(processObjectSupply("Objeto do processo", { version: 1, metadata: { object: "  " } })).toBeNull();
    expect(processObjectSupply("Objeto do processo", { version: 1, metadata: { object: 42 } })).toBeNull();
  });
  it("sem TR emitido ⇒ o objeto do processo (a emissão o registra); sem objeto ⇒ null", () => {
    expect(processObjectSupply(" Aquisição ", null)).toEqual({ source: "processo", value: "Aquisição" });
    expect(processObjectSupply("", null)).toBeNull();
    expect(processObjectSupply(null, null)).toBeNull();
  });
});

describe("processObjectPendingReason (C1)", () => {
  it("TR vigente emitido sem objeto registrado ⇒ motivo LEGACY_TR_WITHOUT_OBJECT com a versão", () => {
    expect(processObjectPendingReason("Objeto do processo", { version: 3, metadata: {} })).toEqual({ code: "LEGACY_TR_WITHOUT_OBJECT", trVersion: 3 });
  });
  it("TR com objeto, ou nenhum TR emitido ⇒ sem motivo", () => {
    expect(processObjectPendingReason("Objeto", { version: 2, metadata: { object: "Objeto" } })).toBeNull();
    expect(processObjectPendingReason("Objeto", null)).toBeNull();
    expect(processObjectPendingReason(null, null)).toBeNull();
  });
});
