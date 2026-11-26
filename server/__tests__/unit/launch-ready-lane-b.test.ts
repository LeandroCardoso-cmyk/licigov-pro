/**
 * LICIGOV-LAUNCH-READY — Lane B — contratos puros: grafias de CNPJ da deduplicação comercial (COM-01) e a
 * superfície de autorização do licenciamento (SEC-04). O comportamento real está no smoke MySQL
 * `server/__tests__/integration/launch-ready-lane-b-mysql-smoke.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cnpjLookupVariants, PROPOSAL_DEDUP_WINDOW_MS } from "../../routers/commercialRouter";

describe("COM-01 — cnpjLookupVariants", () => {
  it("cobre a grafia digitada, só dígitos e máscara", () => {
    expect(new Set(cnpjLookupVariants(" 11.222.333/0001-81 "))).toEqual(
      new Set(["11.222.333/0001-81", "11222333000181"]),
    );
    expect(new Set(cnpjLookupVariants("11222333000181"))).toEqual(new Set(["11222333000181", "11.222.333/0001-81"]));
  });
  it("janela de 24h", () => {
    expect(PROPOSAL_DEDUP_WINDOW_MS).toBe(86_400_000);
  });
});

describe("SEC-04 — mutações de licença não ficam no tenantProcedure puro", () => {
  const src = readFileSync(path.resolve(__dirname, "../../routers/moduleLicensingRouter.ts"), "utf8");
  it("activate/deactivate usam o guard de plataforma; leituras seguem no tenant", () => {
    expect(src).toMatch(/activateModule: platformLicensingProcedure/);
    expect(src).toMatch(/deactivateModule: platformLicensingProcedure/);
    expect(src).toMatch(/ctx\.user\.role === "admin" && ctx\.platformAdminAccess === true/);
    expect(src).toMatch(/listModules: tenantProcedure/);
  });
});
