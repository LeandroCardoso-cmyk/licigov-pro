/**
 * Registro de CÓDIGO versionado do catálogo de variáveis dos Modelos Institucionais (INV-TPL-24/25).
 *
 * `tpl-catalog/1` é o catálogo INICIAL: só variáveis que o `CanonicalReferencePort` real consegue resolver pelo domínio
 * existente (processo, identidade institucional e parâmetros do edital). O catálogo de produção completo (itens, estimativas,
 * textos de ETP/TR) é das fases T4/T5 e entra como NOVA versão — versões antigas permanecem resolvíveis para replay.
 */
import { validateVariableCatalog, type VariableCatalog } from "../../domain/institutionalTemplates";
import type { VariableCatalogPort } from "./ports";

export const TEMPLATE_CATALOG_V1: VariableCatalog = Object.freeze({
  version: "tpl-catalog/1",
  vars: Object.freeze([
    { name: "processo.numero", type: "string", source: "PROCESS", path: "number", required: true },
    { name: "processo.objeto", type: "string", source: "PROCESS", path: "object", required: true },
    { name: "processo.modalidade", type: "string", source: "PROCESS", path: "modality", required: false },
    { name: "orgao.nome", type: "string", source: "IDENTITY", path: "organizationName", required: true },
    { name: "orgao.cnpj", type: "string", source: "IDENTITY", path: "cnpj", required: false },
    { name: "orgao.municipio", type: "string", source: "IDENTITY", path: "municipio", required: false },
    { name: "orgao.uf", type: "string", source: "IDENTITY", path: "uf", required: false },
    { name: "edital.modalidade", type: "string", source: "PARAMS", path: "modality", required: false },
    { name: "edital.forma", type: "string", source: "PARAMS", path: "form", required: false },
    { name: "edital.plataforma", type: "string", source: "PARAMS", path: "platform", required: false },
    { name: "edital.criterioJulgamento", type: "string", source: "PARAMS", path: "judgmentCriterion", required: false },
    { name: "edital.regimeExecucao", type: "string", source: "PARAMS", path: "executionRegime", required: false },
  ]) as VariableCatalog["vars"],
});

const REGISTRY: ReadonlyMap<string, VariableCatalog> = new Map([[TEMPLATE_CATALOG_V1.version, TEMPLATE_CATALOG_V1]]);
export const CURRENT_TEMPLATE_CATALOG_VERSION = TEMPLATE_CATALOG_V1.version;

export function createVariableCatalogPort(): VariableCatalogPort {
  return {
    current: () => REGISTRY.get(CURRENT_TEMPLATE_CATALOG_VERSION)!,
    byVersion: (version) => REGISTRY.get(version) ?? null,
  };
}

// Falha no carregamento do módulo (nunca em runtime) se o catálogo embutido for inválido.
const check = validateVariableCatalog(TEMPLATE_CATALOG_V1);
if (!check.ok) throw new Error(`catálogo de variáveis embutido inválido: ${JSON.stringify(check.issues)}`);
