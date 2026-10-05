/**
 * R9 / SEM-064 — o status da Contratação Direta vem dos ATOS REGISTRADOS (ledger de decisões + publicações), não do
 * ponteiro de etapa; vocabulário de status INALTERADO (HD-09); descrição de mudança de flags para a timeline.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  deriveDirectProcurementStatus, describeFlagChange, setDirectStage, advanceDirectStage, markDirectPublished, createDirectProcurementWorkspace,
  DIRECT_STAGE_ORDER, type DirectProcurementStage, type DirectProcurementStatus, type DirectRecordedActs, type AdaptiveFlags,
} from "../../domain/directProcurementWorkspace";

const NONE: DirectRecordedActs = { ratification: null, publicationCount: 0 };
const RATIFIED: DirectRecordedActs["ratification"] = { outcome: "ratificado", revision: 1, decidedAt: "2026-09-30" };
const NOT_RATIFIED: DirectRecordedActs["ratification"] = { outcome: "nao_ratificado", revision: 2, decidedAt: "2026-10-01" };
const stored = (status: DirectProcurementStatus, currentStage: DirectProcurementStage = "NEW") => ({ status, currentStage });

describe("SEM-064 — deriveDirectProcurementStatus", () => {
  it("'ratificado'/'publicado' gravados SEM ato ⇒ não afirmam o ato (em_andamento) e são marcados como não sustentados", () => {
    expect(deriveDirectProcurementStatus(stored("ratificado", "RATIFICATION"), NONE)).toEqual({ status: "em_andamento", ratification: "NO_RECORDED_ACT", publication: "NO_RECORDED_ACT", unsupportedPointerClaims: ["ratificado"] });
    expect(deriveDirectProcurementStatus(stored("publicado", "PUBLICATION"), NONE)).toMatchObject({ status: "em_andamento", unsupportedPointerClaims: ["publicado"] });
  });
  it("ratificação corrente 'ratificado' no ledger ⇒ 'ratificado' (mesmo se o ponteiro regrediu para aguardando_parecer)", () => {
    expect(deriveDirectProcurementStatus(stored("aguardando_parecer", "LEGAL_OPINION"), { ratification: RATIFIED, publicationCount: 0 }))
      .toEqual({ status: "ratificado", ratification: "RECORDED_RATIFIED", publication: "NO_RECORDED_ACT", unsupportedPointerClaims: [] });
  });
  it("ratificado + publicações gravadas ⇒ 'publicado'; sem ratificação corrente, publicações sozinhas NÃO bastam", () => {
    expect(deriveDirectProcurementStatus(stored("publicado", "PUBLICATION"), { ratification: RATIFIED, publicationCount: 2 }))
      .toEqual({ status: "publicado", ratification: "RECORDED_RATIFIED", publication: "RECORDED", unsupportedPointerClaims: [] });
    expect(deriveDirectProcurementStatus(stored("publicado", "PUBLICATION"), { ratification: null, publicationCount: 2 }))
      .toMatchObject({ status: "em_andamento", publication: "RECORDED", unsupportedPointerClaims: ["publicado"] });
  });
  it("'não ratificado' é uma BASE, não um status novo (HD-09): o status volta a em_andamento", () => {
    const d = deriveDirectProcurementStatus(stored("publicado", "PUBLICATION"), { ratification: NOT_RATIFIED, publicationCount: 2 });
    expect(d).toMatchObject({ status: "em_andamento", ratification: "RECORDED_NOT_RATIFIED", unsupportedPointerClaims: ["publicado"] });
    const vocabulary: DirectProcurementStatus[] = ["rascunho", "em_andamento", "aguardando_parecer", "ratificado", "publicado", "concluido", "arquivado"];
    expect(vocabulary).toContain(d.status);
  });
  it("status que não afirmam ato seguem o valor gravado", () => {
    for (const s of ["rascunho", "em_andamento", "aguardando_parecer", "concluido", "arquivado"] as const) {
      expect(deriveDirectProcurementStatus(stored(s), NONE).status).toBe(s);
    }
  });
  it("é puro/determinístico e não depende da ETAPA (ponteiro)", () => {
    for (const stage of DIRECT_STAGE_ORDER) {
      expect(deriveDirectProcurementStatus(stored("em_andamento", stage), { ratification: RATIFIED, publicationCount: 0 }).status).toBe("ratificado");
      expect(deriveDirectProcurementStatus(stored("em_andamento", stage), NONE).status).toBe("em_andamento");
    }
  });
});

describe("SEM-064 — o ponteiro de etapa não afirma atos", () => {
  const ws = createDirectProcurementWorkspace({ organizationId: 1, processNumber: "P-1", object: "o", procurementType: "dispensa", startOption: "sem_dfd", responsibleUser: 1, correlationId: "c" });
  it("setDirectStage/advanceDirectStage em RATIFICATION/PUBLICATION ⇒ em_andamento", () => {
    expect(setDirectStage(ws, "RATIFICATION").status).toBe("em_andamento");
    expect(setDirectStage(ws, "PUBLICATION").status).toBe("em_andamento");
    expect(advanceDirectStage(setDirectStage(ws, "RATIFICATION")).status).toBe("em_andamento");
  });
  it("só markDirectPublished (chamado após gravar as publicações) marca 'publicado'", () => {
    expect(markDirectPublished(ws)).toMatchObject({ currentStage: "PUBLICATION", status: "publicado" });
  });
});

describe("SEM-064 — describeFlagChange (evento de configureFlags)", () => {
  const base: AdaptiveFlags = { usesDFD: true, requiresPriceResearch: true, requiresProposalCollection: true, requiresLegalOpinion: true };
  it("sem mudança ⇒ null (no-op: nenhum evento)", () => {
    expect(describeFlagChange(base, { ...base })).toBeNull();
  });
  it("desligar o parecer ⇒ evento de DECISÃO, antes→depois e destaque", () => {
    const d = describeFlagChange(base, { ...base, requiresLegalOpinion: false });
    expect(d?.eventType).toBe("decision");
    expect(d?.summary).toContain("Exige parecer jurídico: sim → não");
    expect(d?.summary).toContain("deixou de ser exigido");
  });
  it("outras flags ⇒ evento 'change', lista todas as mudanças", () => {
    const d = describeFlagChange(base, { ...base, requiresPriceResearch: false, usesDFD: false, requiresLegalOpinion: true });
    expect(d?.eventType).toBe("change");
    expect(d?.summary).toContain("Usa DFD: sim → não");
    expect(d?.summary).toContain("Exige pesquisa de preços: sim → não");
    expect(d?.summary).not.toContain("deixou de ser exigido");
    // ligar o parecer de volta não é "desligar"
    expect(describeFlagChange({ ...base, requiresLegalOpinion: false }, base)?.eventType).toBe("change");
  });
});

describe("SEM-064 — guards estáticos", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "../../..", rel), "utf8");
  it("publish só marca 'publicado' DEPOIS de gerar as publicações e não usa o extrato incondicional", () => {
    const r = read("server/routers/directProcurementRouter.ts");
    const publish = r.slice(r.indexOf("  publish: orgRoleProcedure"), r.indexOf("// NEW-005 — WORKFLOW_CONFIGURATION"));
    expect(publish.indexOf("generatePublications(")).toBeGreaterThan(-1);
    expect(publish.indexOf("generatePublications(")).toBeLessThan(publish.indexOf("markDirectPublished("));
    expect(publish).not.toContain('setDirectStage(ws, "PUBLICATION")');
    const svc = read("server/services/directProcurementService.ts");
    expect(svc).not.toContain('["aviso", "ratificacao", "extrato_contrato"]');
  });
  it("configureFlags não usa o upsert do workspace (que regravava etapa/status) e grava o evento", () => {
    const r = read("server/routers/directProcurementRouter.ts");
    const cf = r.slice(r.indexOf("  configureFlags: orgRoleProcedure"));
    expect(cf).toContain("updateDirectWorkspaceFlagsWithEvent");
    expect(cf).not.toContain("insertDirectProcurementWorkspace");
  });
  it("loadProcess/listProcesses derivam o status dos atos registrados", () => {
    const r = read("server/routers/directProcurementRouter.ts");
    expect(r.match(/deriveDirectProcurementStatus\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(r.match(/getRecordedActsForWorkspaces\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
