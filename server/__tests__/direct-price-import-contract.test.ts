/**
 * R2 / PR-04A — LEG-014 / FCC-01 — contrato PURO da identidade de importação da Pesquisa de Preços da
 * Contratação Direta (sem DB). A persistência real (idempotência, transação, tenant, RBAC, rollback) é
 * provada em integration/direct-price-import-governed-mysql-smoke.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  planDirectPriceImport, computeDirectPriceImportContentHash, computeDirectPriceImportPayloadHash,
  deriveDirectPriceImportId,
} from "../domain/directPriceImport";
import { createPriceResearchWorkspace, extractItemsFromText } from "../domain/priceResearch";

const ORG = 4401;
const WS = "ws-pr04a-0000000001";
const plan = (text: string, extra: Partial<Parameters<typeof planDirectPriceImport>[0]> = {}) =>
  planDirectPriceImport({ workspaceId: WS, organizationId: ORG, source: "colar", text, correlationId: "c", ...extra });

describe("PR-04A — identidade explícita da importação (domínio)", () => {
  it("conteúdos diferentes ⇒ importIds e ids de cotação DISJUNTOS (nunca reusa a importação anterior)", () => {
    const a = plan("Caneta;100;un;1,50;Fornecedor A");
    const b = plan("Caneta;100;un;1,80;Fornecedor B");
    expect(a.importId).not.toBe(b.importId);
    expect(a.items[0].id).not.toBe(b.items[0].id);
    expect(a.items.every((i) => i.researchId === a.importId)).toBe(true);
    expect(a.research.id).toBe(a.importId);
  });

  it("ids novos nunca colidem com o espaço de ids do caminho legado (prw/pri)", () => {
    const legacy = createPriceResearchWorkspace({ processId: WS, organizationId: ORG, source: "colar", correlationId: "c" });
    const legacyItems = extractItemsFromText("Caneta;100;un;1,50;Fornecedor A", { researchId: legacy.id, processId: WS, organizationId: ORG });
    const a = plan("Caneta;100;un;1,50;Fornecedor A");
    expect(a.importId).not.toBe(legacy.id);
    expect(a.items[0].id).not.toBe(legacyItems[0].id);
  });

  it("caminho legado inalterado: id da pesquisa continua (org, processo, fonte) — sem mudança de semântica", () => {
    const x = createPriceResearchWorkspace({ processId: WS, organizationId: ORG, source: "colar", correlationId: "c1" });
    const y = createPriceResearchWorkspace({ processId: WS, organizationId: ORG, source: "colar", correlationId: "c2" });
    expect(x.id).toBe(y.id);
  });

  it("T13 — contentHash normalizado: caixa/espaços/ordem/formato monetário não mudam o hash; valor/fornecedor mudam", () => {
    const base = plan("Caneta;100;un;1,50;Fornecedor A\nLápis;10;un;0,90;Fornecedor A");
    expect(base.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(plan("  lápis ; 10 ; UN ; 0,90 ; fornecedor   a\n\ncaneta;100;un;R$ 1,50;FORNECEDOR A").contentHash).toBe(base.contentHash);
    expect(plan("Caneta;100;un;1,51;Fornecedor A\nLápis;10;un;0,90;Fornecedor A").contentHash).not.toBe(base.contentHash);
    expect(plan("Caneta;100;un;1,50;Fornecedor B\nLápis;10;un;0,90;Fornecedor A").contentHash).not.toBe(base.contentHash);
    // multiconjunto: cotação duplicada na MESMA colagem é conteúdo diferente
    expect(plan("Caneta;100;un;1,50;Fornecedor A\nCaneta;100;un;1,50;Fornecedor A\nLápis;10;un;0,90;Fornecedor A").contentHash).not.toBe(base.contentHash);
  });

  it("contentHash é recomputável a partir das linhas persistidas (decimais em string)", () => {
    const p = plan("Caneta;100;un;1,50;Fornecedor A");
    const fromDb = p.items.map((i) => ({ ...i, quantity: "100.000", value: "1.50" }));
    expect(computeDirectPriceImportContentHash(fromDb)).toBe(p.contentHash);
  });

  it("identidade é escopada por organização e workspace; fonte é linhagem (não conteúdo), mas entra no payloadHash", () => {
    const p = plan("Caneta;100;un;1,50");
    expect(deriveDirectPriceImportId(ORG + 1, WS, p.contentHash)).not.toBe(p.importId);
    expect(deriveDirectPriceImportId(ORG, "ws-outro", p.contentHash)).not.toBe(p.importId);
    const csv = plan("Caneta;100;un;1,50", { source: "csv" });
    expect(csv.importId).toBe(p.importId);
    expect(csv.items[0].source).toBe("csv");
    const ph = (source: "colar" | "csv") => computeDirectPriceImportPayloadHash({ operation: "op", organizationId: ORG, workspaceId: WS, source, contentHash: p.contentHash });
    expect(ph("colar")).not.toBe(ph("csv"));
  });

  it("determinístico e sem IA/rede: o plano é puro (mesma entrada ⇒ mesmos ids)", () => {
    const a = plan("Caneta;100;un;1,50", { createdAt: "2026-01-01T00:00:00.000Z" });
    const b = plan("Caneta;100;un;1,50", { createdAt: "2026-01-01T00:00:00.000Z" });
    expect(a).toEqual(b);
    const src = readFileSync(path.join(process.cwd(), "server/domain/directPriceImport.ts"), "utf8");
    expect(src).not.toMatch(/invokeLLM|fetch\(|storagePut|sendEmail|webhook/i);
  });
});

describe("PR-04A — superfície do router (estática)", () => {
  const src = readFileSync(path.join(process.cwd(), "server/routers/directProcurementRouter.ts"), "utf8");
  it("importPriceResearch exige operator+ e idempotencyKey", () => {
    expect(src).toMatch(/importPriceResearch:\s*orgRoleProcedure\("operator"\)/);
    const block = src.slice(src.indexOf("importPriceResearch:"), src.indexOf("configureProcedure:"));
    expect(block).toContain("idempotencyKey: z.string().trim().min(8).max(128)");
  });
  it("o serviço não chama IA/storage/e-mail na importação", () => {
    const svc = readFileSync(path.join(process.cwd(), "server/services/directProcurementService.ts"), "utf8");
    const fn = svc.slice(svc.indexOf("export async function importDirectPriceResearch"), svc.indexOf("// ─── Justificativa da Contratação"));
    expect(fn).not.toMatch(/orchestrateMultiCopilot|invokeLLM|generateOfficialDocument|storagePut|sendEmail|fetch\(/);
    expect(fn).toContain("db.transaction");
  });
});
