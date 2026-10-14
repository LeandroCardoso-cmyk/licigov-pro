/**
 * Guardas do executor de homologação E2E (scripts/homologation-e2e.ts): só o tenant sintético, nunca a organização 1;
 * pendências contadas sem inventar; exportação validada pelos bytes.
 */
import { describe, it, expect } from "vitest";
import { assertSyntheticTenant, looksLike, pendingMarkers, SYNTHETIC_TENANT_SLUG } from "../../../scripts/homologation-e2e";

describe("executor de homologação — guardas", () => {
  it("aceita só o slug sintético e recusa a organização 1 e ausência de vínculo", () => {
    expect(() => assertSyntheticTenant({ id: 42, slug: SYNTHETIC_TENANT_SLUG })).not.toThrow();
    expect(() => assertSyntheticTenant({ id: 1, slug: SYNTHETIC_TENANT_SLUG })).toThrow(/organização 1/);
    expect(() => assertSyntheticTenant({ id: 7, slug: "moreira-sales" })).toThrow(/Tenant recusado/);
    expect(() => assertSyntheticTenant(undefined)).toThrow(/não é membro/);
  });

  it("conta as pendências visíveis da composição", () => {
    const t = "Objeto [REVISAR: objeto] · qtd [a definir] · data A DEFINIR PARA PUBLICAÇÃO e A DEFINIR PARA PUBLICAÇÃO";
    expect(pendingMarkers(t)).toEqual({ revisar: 1, aDefinir: 1, publicacao: 2 });
    expect(pendingMarkers("texto completo")).toEqual({ revisar: 0, aDefinir: 0, publicacao: 0 });
  });

  it("reconhece DOCX e PDF pelos bytes", () => {
    expect(looksLike("docx", new Uint8Array(Buffer.from("PK\u0003\u0004")))).toBe(true);
    expect(looksLike("pdf", new Uint8Array(Buffer.from("%PDF-1.7")))).toBe(true);
    expect(looksLike("pdf", new Uint8Array(Buffer.from("PK\u0003\u0004")))).toBe(false);
  });
});
