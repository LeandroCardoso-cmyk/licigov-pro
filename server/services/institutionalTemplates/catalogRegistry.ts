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

/** Marcos do cronograma do certame expostos ao catálogo (a configuração aceita outros nomes; o catálogo é o vocabulário). */
const CERTAME_MILESTONES = ["publicacao_edital", "inicio_recebimento_propostas", "fim_recebimento_propostas", "abertura_propostas", "inicio_disputa"] as const;

/**
 * `tpl-catalog/2` = v1 (INALTERADO, replay) + as fontes canônicas do multi-modelo. Cada variável aponta para UMA autoridade
 * (`source`); `required` só pesa quando a variável é referenciada pelo AST. Variáveis de POLICY e de citações NORMATIVE
 * específicas entram quando o Owner definir as chaves de política/o conjunto normativo (versão nova do catálogo) — o adapter e
 * o contrato já estão prontos; o catálogo não inventa política nem norma.
 */
export const TEMPLATE_CATALOG_V2: VariableCatalog = Object.freeze({
  version: "tpl-catalog/2",
  vars: Object.freeze([
    ...TEMPLATE_CATALOG_V1.vars,
    // ITEMS — Itens da contratação canônicos (HD-01); o quadro é derivado SÓ desta autoridade
    { name: "itens.quantidade", type: "number", source: "ITEMS", path: "itemCount", required: true },
    { name: "itens.quantidadeLotes", type: "number", source: "ITEMS", path: "lotCount", required: false },
    { name: "itens.quadro", type: "list", source: "ITEMS", path: "quadroLinhas", required: true },
    { name: "itens.valorEstimadoGlobal", type: "money", source: "ITEMS", path: "estimatedTotalCents", required: false },
    // BUDGET — divulgação decidida + estimativa (valor só quando PÚBLICO)
    { name: "orcamento.divulgacao", type: "string", source: "BUDGET", path: "disclosure", required: true },
    { name: "orcamento.valorEstimado", type: "money", source: "BUDGET", path: "estimatedTotalCents", required: false },
    // CERTAME_CONFIG — decisão do órgão sobre o certame (nenhum valor de plataforma no código)
    { name: "certame.modoDisputa", type: "string", source: "CERTAME_CONFIG", path: "disputeMode", required: true },
    { name: "certame.regraAbertoFechado", type: "string", source: "CERTAME_CONFIG", path: "openClosedRule", required: false },
    { name: "certame.casasDecimais", type: "number", source: "CERTAME_CONFIG", path: "decimalPlaces", required: false },
    { name: "certame.intervaloMinimoTipo", type: "string", source: "CERTAME_CONFIG", path: "minimumBidInterval.kind", required: false },
    { name: "certame.intervaloMinimoValor", type: "number", source: "CERTAME_CONFIG", path: "minimumBidInterval.value", required: false },
    { name: "certame.duracaoEtapaMinutos", type: "number", source: "CERTAME_CONFIG", path: "stageDurationMinutes", required: false },
    { name: "certame.regraProrrogacao", type: "string", source: "CERTAME_CONFIG", path: "extensionRule", required: false },
    { name: "certame.prorrogacaoMinutos", type: "number", source: "CERTAME_CONFIG", path: "extensionMinutes", required: false },
    { name: "certame.janelasOperacionais", type: "list", source: "CERTAME_CONFIG", path: "operationalWindowLines", required: false },
    ...CERTAME_MILESTONES.flatMap((m) => [
      { name: `certame.${m}.data`, type: "date", source: "CERTAME_CONFIG", path: `schedule.${m}.date`, required: false },
      { name: `certame.${m}.hora`, type: "string", source: "CERTAME_CONFIG", path: `schedule.${m}.time`, required: false },
    ] as const),
    // NORMATIVE — metadados do reference set VERIFICADO (citações específicas entram com o conjunto normativo do Owner)
    { name: "normativo.versaoConjunto", type: "number", source: "NORMATIVE", path: "referenceSetVersion", required: false },
    { name: "normativo.hashConjunto", type: "string", source: "NORMATIVE", path: "referenceSetContentHash", required: false },
    { name: "normativo.autoridadeFonte", type: "string", source: "NORMATIVE", path: "sourceAuthority", required: false },
    { name: "normativo.metodoVerificacao", type: "string", source: "NORMATIVE", path: "verificationMethod", required: false },
    { name: "normativo.vigenteDesde", type: "date", source: "NORMATIVE", path: "effectiveFrom", required: false },
    // LIFECYCLE — ciclo de vida do processo
    { name: "ciclo.estado", type: "string", source: "LIFECYCLE", path: "state", required: false },
    { name: "ciclo.geracao", type: "number", source: "LIFECYCLE", path: "generation", required: false },
  ]) as VariableCatalog["vars"],
});

/** Versões antigas permanecem resolvíveis (replay de manifests/revisões que as referenciam); `current` é a mais nova. */
const REGISTRY: ReadonlyMap<string, VariableCatalog> = new Map([
  [TEMPLATE_CATALOG_V1.version, TEMPLATE_CATALOG_V1],
  [TEMPLATE_CATALOG_V2.version, TEMPLATE_CATALOG_V2],
]);
export const CURRENT_TEMPLATE_CATALOG_VERSION = TEMPLATE_CATALOG_V2.version;

export function createVariableCatalogPort(): VariableCatalogPort {
  return {
    current: () => REGISTRY.get(CURRENT_TEMPLATE_CATALOG_VERSION)!,
    byVersion: (version) => REGISTRY.get(version) ?? null,
  };
}

// Falha no carregamento do módulo (nunca em runtime) se o catálogo embutido for inválido.
for (const c of REGISTRY.values()) {
  const check = validateVariableCatalog(c);
  if (!check.ok) throw new Error(`catálogo de variáveis embutido inválido (${c.version}): ${JSON.stringify(check.issues)}`);
}
