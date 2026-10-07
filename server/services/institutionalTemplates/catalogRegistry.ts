/**
 * Registro de CÓDIGO versionado dos catálogos de variáveis dos Modelos Institucionais (INV-TPL-24/25).
 *
 *  - `tpl-catalog/1` (formato v1): catálogo INICIAL, só variáveis que o domínio resolvia na T2 (processo, identidade, parâmetros
 *    do edital). INALTERADO — revisões `tpl-ast/1` continuam reproduzíveis byte a byte.
 *  - Catálogos `tpl-catalog/2` (formato v2): UM POR MODELO/VERSÃO (ex.: `edital-pregao-eletronico-bll/1.0.1-draft.c2`), carregados
 *    dos pacotes de modelo versionados (`modelPackages.ts`). Um catálogo v2 já usado por uma revisão é imutável.
 * Revisão de AST v1 ⇒ catálogo v1; AST v2 ⇒ catálogo v2 da MESMA versão (nunca coerção silenciosa).
 */
import { validateAnyCatalog, type AnyVariableCatalog, type VariableCatalog } from "../../domain/institutionalTemplates";
import { MODEL_PACKAGES } from "./modelPackages";
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

/** Catálogo padrão para autoria `tpl-ast/1` (modelos novos de AST v2 informam a versão do catálogo do seu pacote). */
export const CURRENT_TEMPLATE_CATALOG_VERSION = TEMPLATE_CATALOG_V1.version;

const REGISTRY: ReadonlyMap<string, AnyVariableCatalog> = new Map<string, AnyVariableCatalog>([
  [TEMPLATE_CATALOG_V1.version, TEMPLATE_CATALOG_V1],
  ...MODEL_PACKAGES.map((p): [string, AnyVariableCatalog] => [p.catalog.version, p.catalog]),
]);

export function createVariableCatalogPort(): VariableCatalogPort {
  return {
    current: () => REGISTRY.get(CURRENT_TEMPLATE_CATALOG_VERSION) as VariableCatalog,
    byVersion: (version) => REGISTRY.get(version) ?? null,
  };
}

// Falha no carregamento do módulo (nunca em runtime) se um catálogo embutido for inválido ou houver versão duplicada.
if (REGISTRY.size !== 1 + MODEL_PACKAGES.length) throw new Error("catálogo de variáveis duplicado no registro de modelos");
for (const c of REGISTRY.values()) {
  const check = validateAnyCatalog(c);
  if (!check.ok) throw new Error(`catálogo de variáveis embutido inválido (${c.version}): ${JSON.stringify(check.issues)}`);
}
