/**
 * M8 — `priceGovernanceService.demonstrativePricesAllowed`: a identidade da organização é lida no BACKEND (nunca do
 * cliente) e a exceção é fail-closed: sem configuração não há consulta ao banco [32]; org 1 nunca [35].
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getOrganizationById = vi.fn();
vi.mock("../../db/organizations", () => ({ getOrganizationById: (...a: unknown[]) => getOrganizationById(...a) }));

import { __setHomologationConfigForTests, demonstrativePricesAllowed } from "../../services/priceGovernanceService";

describe("M8 — exceção de homologação no serviço (identidade real lida no backend)", () => {
  beforeEach(() => { getOrganizationById.mockReset(); });
  afterEach(() => __setHomologationConfigForTests(null));

  it("[32] sem configuração (lista vazia) ⇒ false SEM consultar o banco", async () => {
    __setHomologationConfigForTests({ allowedOrgIds: [], appEnv: "staging" });
    expect(await demonstrativePricesAllowed(42)).toBe(false);
    expect(getOrganizationById).not.toHaveBeenCalled();
  });

  it("[31] autorizada + slug real `homologacao-sintetica` + não produtivo ⇒ true", async () => {
    __setHomologationConfigForTests({ allowedOrgIds: [42], appEnv: "staging" });
    getOrganizationById.mockResolvedValue({ id: 42, slug: "homologacao-sintetica" });
    expect(await demonstrativePricesAllowed(42)).toBe(true);
    expect(getOrganizationById).toHaveBeenCalledWith(42);
  });

  it("[33] org não listada ⇒ false sem consulta; listada com slug real divergente ⇒ false", async () => {
    __setHomologationConfigForTests({ allowedOrgIds: [42], appEnv: "staging" });
    expect(await demonstrativePricesAllowed(43)).toBe(false);
    expect(getOrganizationById).not.toHaveBeenCalled();
    getOrganizationById.mockResolvedValue({ id: 42, slug: "prefeitura-real" });
    expect(await demonstrativePricesAllowed(42)).toBe(false);
  });

  it("[34] produção ⇒ false mesmo listada e com slug correto", async () => {
    __setHomologationConfigForTests({ allowedOrgIds: [42], appEnv: "production" });
    getOrganizationById.mockResolvedValue({ id: 42, slug: "homologacao-sintetica" });
    expect(await demonstrativePricesAllowed(42)).toBe(false);
  });

  it("[35] organização 1 ⇒ false mesmo listada e com o slug sintético", async () => {
    __setHomologationConfigForTests({ allowedOrgIds: [1], appEnv: "development" });
    getOrganizationById.mockResolvedValue({ id: 1, slug: "homologacao-sintetica" });
    expect(await demonstrativePricesAllowed(1)).toBe(false);
  });

  it("falha na leitura da organização ⇒ false (fail-closed)", async () => {
    __setHomologationConfigForTests({ allowedOrgIds: [42], appEnv: "staging" });
    getOrganizationById.mockImplementation(async () => { throw new Error("db down"); });
    expect(await demonstrativePricesAllowed(42)).toBe(false);
  });
});
