/**
 * Fixtures CONTRATUAIS do catálogo oficial CATMAT/CATSER para testes (dados SINTÉTICOS, montados à mão no formato do
 * envelope `resultado` da API de Dados Abertos). Só alimentam o transporte injetado do `officialCatalogService`; não
 * vêm de consulta em runtime e não existem fora da suíte. O smoke real é separado (`scripts/catalog-official-smoke.ts`).
 */
import { __setOfficialCatalogFetchForTests, __clearOfficialCatalogCacheForTests } from "../../services/officialCatalogService";

export const SYNTHETIC_CATMAT_CANETA = {
  resultado: [
    { codigoItem: 279380, descricaoItem: "CANETA ESFEROGRÁFICA AZUL, CORPO TRANSPARENTE", statusItem: true, nomeGrupo: "MATERIAL DE EXPEDIENTE" },
    { codigoItem: 279381, descricaoItem: "CANETA ESFEROGRÁFICA AZUL, PONTA FINA", statusItem: true, nomeGrupo: "MATERIAL DE EXPEDIENTE" },
  ],
  totalRegistros: 2,
};

/** Liga o transporte injetado devolvendo a fixture (CATMAT e CATSER). Chame `restoreOfficialCatalog()` ao final. */
export function serveOfficialCatalogFixture(catmat: unknown = SYNTHETIC_CATMAT_CANETA, catser: unknown = { resultado: [] }): void {
  __clearOfficialCatalogCacheForTests();
  __setOfficialCatalogFetchForTests(async (url) => ({ ok: true, status: 200, json: async () => (url.includes("modulo-servico") ? catser : catmat) }));
}

export function restoreOfficialCatalog(): void {
  __setOfficialCatalogFetchForTests(null);
  __clearOfficialCatalogCacheForTests();
}
