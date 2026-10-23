/**
 * Guardas do executor de homologação E2E (scripts/homologation-e2e.ts): só staging autorizado ou servidor local; só o tenant
 * sintético, nunca a organização 1; credencial sem acesso cross-tenant; exercício nunca presumido; número NNNN/AAAA;
 * pendências contadas sem inventar; exportação validada pelos bytes; decisão marcada como dado de teste.
 */
import { describe, it, expect } from "vitest";
import {
  assertAllowedTarget, assertOrgRoleAtLeast, assertSyntheticCredential, parseOrganizationId, assertSyntheticTenant, looksLike, parseExercicio, pendingMarkers,
  SYNTHETIC_TENANT_SLUG, syntheticDecision, syntheticProcessNumber, technicalResidue,
  priceImportMode, priceResearchCsv, sha256Hex,
} from "../../../scripts/homologation-e2e";
import { processNumberParts } from "../../domain/institutionalTemplates/processYear";

describe("executor de homologação — guardas", () => {
  it("destino: só o staging autorizado (HTTPS) ou servidor local", () => {
    expect(assertAllowedTarget("https://licigov-pro-staging.up.railway.app").hostname).toBe("licigov-pro-staging.up.railway.app");
    expect(() => assertAllowedTarget("http://127.0.0.1:3999")).not.toThrow();
    expect(() => assertAllowedTarget("http://licigov-pro-staging.up.railway.app")).toThrow(/Destino recusado/);
    expect(() => assertAllowedTarget("https://licigov-pro-production.up.railway.app")).toThrow(/Destino recusado/);
    expect(() => assertAllowedTarget("https://app.licigov.com.br")).toThrow(/Destino recusado/);
    expect(() => assertAllowedTarget("nao-e-url")).toThrow(/inválida/);
  });

  it("tenant: só o slug sintético, nunca a organização 1", () => {
    expect(() => assertSyntheticTenant({ id: 42, slug: SYNTHETIC_TENANT_SLUG })).not.toThrow();
    expect(() => assertSyntheticTenant({ id: 1, slug: SYNTHETIC_TENANT_SLUG })).toThrow(/organização 1/);
    expect(() => assertSyntheticTenant({ id: 7, slug: "moreira-sales" })).toThrow(/Tenant recusado/);
    expect(() => assertSyntheticTenant(undefined)).toThrow(/não é membro/);
  });

  it("credencial: nem admin de plataforma, nem membro da organização 1", () => {
    expect(() => assertSyntheticCredential({ role: "user" }, [42])).not.toThrow();
    expect(() => assertSyntheticCredential({ role: "admin" }, [42])).toThrow(/admin de plataforma/);
    expect(() => assertSyntheticCredential({ role: "user" }, [42, 1])).toThrow(/organização 1/);
    expect(() => assertSyntheticCredential(null, [42])).toThrow(/sessão/);
  });

  it("exercício explícito e número NNNN/AAAA reconhecido pelo motor documental", () => {
    expect(() => parseExercicio(undefined)).toThrow(/nunca é presumido/);
    expect(() => parseExercicio("26")).toThrow();
    const n = syntheticProcessNumber("ABC123", parseExercicio("2026"));
    expect(n).toMatch(/^\d{4}\/2026$/);
    expect(processNumberParts(n)).toEqual({ year: 2026, sequence: n.split("/")[0] });
    expect(syntheticProcessNumber("ABC123", 2026, 1)).not.toBe(n);
  });

  it("pendências, resíduos técnicos e formato dos arquivos", () => {
    const t = "Objeto [REVISAR: objeto] · qtd [a definir] · data A DEFINIR PARA PUBLICAÇÃO e A DEFINIR PARA PUBLICAÇÃO";
    expect(pendingMarkers(t)).toEqual({ revisar: 1, aDefinir: 1, publicacao: 2 });
    expect(technicalResidue("texto {{var}} SYSTEM NOTE ⟦x⟧")).toEqual(["placeholder {{ }}", "SYSTEM NOTE", "xref"]);
    expect(technicalResidue("texto limpo")).toEqual([]);
    expect(looksLike("docx", new Uint8Array(Buffer.from("PK\u0003\u0004")))).toBe(true);
    expect(looksLike("pdf", new Uint8Array(Buffer.from("%PDF-1.7")))).toBe(true);
    expect(looksLike("pdf", new Uint8Array(Buffer.from("PK\u0003\u0004")))).toBe(false);
  });

  it("decisão governada marcada como dado de teste (sem imitar ato administrativo)", () => {
    const d = syntheticDecision({ id: 9, name: "Usuária Teste" }, "2026-10-14");
    expect(d).toMatchObject({ decidedByName: "Usuária Teste", decidedByUserId: 9, decidedAt: "2026-10-14" });
    expect(d.basisReference).toMatch(/HOMOLOGAÇÃO SINTÉTICA.*sem ato administrativo/);
    expect(JSON.stringify(d)).not.toMatch(/Portaria|Procurador/);
  });

  it("organização fixada (HOMOLOG_ORGANIZATION_ID): opcional, inteiro positivo, nunca a organização 1", () => {
    expect(parseOrganizationId(undefined)).toBeNull();
    expect(parseOrganizationId(" ")).toBeNull();
    expect(parseOrganizationId("2")).toBe(2);
    expect(() => parseOrganizationId("1")).toThrow(/organização 1/);
    expect(() => parseOrganizationId("0")).toThrow(/inválido/);
    expect(() => parseOrganizationId("dois")).toThrow(/inválido/);
  });

  it("papel mínimo no tenant sintético: atos governados e emissão exigem manager", () => {
    expect(() => assertOrgRoleAtLeast("manager", "manager", "u1")).not.toThrow();
    expect(() => assertOrgRoleAtLeast("owner", "manager", "u1")).not.toThrow();
    expect(() => assertOrgRoleAtLeast("operator", "manager", "u1")).toThrow(/necessário 'manager'/);
    expect(() => assertOrgRoleAtLeast(null, "operator", "u2")).toThrow(/papel 'nenhum'/);
  });

  // PR-04 (SEM-005): Pesquisa de Preços pela ingestão canônica quando o tenant a tem ligada.
  it("modo da Pesquisa de Preços pela capability oficial; ligada sem CSV ⇒ erro explícito (nunca cai no legado)", () => {
    expect(priceImportMode({ enabled: false, supportedFormats: [] })).toBe("legacy");
    expect(priceImportMode({ enabled: true, supportedFormats: [{ key: "xlsx", supported: true }, { key: "csv", supported: true }] })).toBe("canonical");
    expect(() => priceImportMode({ enabled: true, supportedFormats: [{ key: "csv", supported: false }] })).toThrow(/CSV/);
    expect(() => priceImportMode({ enabled: true, supportedFormats: [] })).toThrow(/CSV/);
  });

  it("CSV da pesquisa: cabeçalho reconhecido, uma linha por cotação; checksum SHA-256 real", () => {
    const csv = priceResearchCsv([{ description: "Papel A4", planned: 10, unit: "resma", price: "25,50", supplier: "Fornecedor Fictício A" }]);
    expect(csv.split("\n")).toEqual(["Descrição;Quantidade;Unidade;Valor unitário;Fornecedor", "Papel A4;10;resma;25,50;Fornecedor Fictício A"]);
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
