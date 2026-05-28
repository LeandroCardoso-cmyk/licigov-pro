/**
 * Sprint 2.9 — Parser Capability Matrix.
 *
 * Cada parser declara suas capacidades, limitações e confiança por tipo de dado.
 * Usado pelo NormalizationPipeline para selecionar estratégias adequadas.
 */

import type { ParserType } from "./importTypes";

// ─── Capability flags ─────────────────────────────────────────────────────────

export interface ParserCapability {
  parserType:    ParserType;
  parserVersion: string;

  // Suporte a estruturas
  supportsMultiSheet:   boolean;
  supportsMultiPage:    boolean;
  supportsFormulas:     boolean;
  supportsMergedCells:  boolean;
  supportsImages:       boolean;
  supportsHeaders:      boolean;  // detecção automática de cabeçalhos
  supportsFooters:      boolean;

  // Confiança média por campo (0–1)
  descriptionConfidence: number;
  quantityConfidence:    number;
  unitConfidence:        number;
  priceConfidence:       number;

  // Limitações conhecidas
  limitations: string[];

  // Hints para o pipeline de normalização
  requiresManualUnitReview:    boolean; // unidades frequentemente ambíguas
  requiresManualPriceReview:   boolean; // preços em formato não estruturado
  likelihoodOfMergedHeaders:   number;  // 0–1
  likelihoodOfFooterRows:      number;  // 0–1

  // Metadados
  registeredAt: string; // ISO 8601
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class ParserCapabilityRegistry {
  private readonly registry = new Map<ParserType, ParserCapability>();

  register(capability: ParserCapability): this {
    this.registry.set(capability.parserType, capability);
    return this;
  }

  get(parserType: ParserType): ParserCapability | null {
    return this.registry.get(parserType) ?? null;
  }

  getAll(): ParserCapability[] {
    return Array.from(this.registry.values());
  }

  has(parserType: ParserType): boolean {
    return this.registry.has(parserType);
  }

  getSupportedTypes(): ParserType[] {
    return Array.from(this.registry.keys());
  }

  getBestParserFor(requirements: {
    multiSheet?:   boolean;
    multiPage?:    boolean;
    highPriceConf?: boolean;
  }): ParserCapability | null {
    const candidates = this.getAll().filter(cap => {
      if (requirements.multiSheet && !cap.supportsMultiSheet)  return false;
      if (requirements.multiPage  && !cap.supportsMultiPage)   return false;
      if (requirements.highPriceConf && cap.priceConfidence < 0.70) return false;
      return true;
    });

    if (candidates.length === 0) return null;

    // Ranquear por média de confiança
    return candidates.sort((a, b) => {
      const scoreA = (a.descriptionConfidence + a.quantityConfidence + a.unitConfidence + a.priceConfidence) / 4;
      const scoreB = (b.descriptionConfidence + b.quantityConfidence + b.unitConfidence + b.priceConfidence) / 4;
      return scoreB - scoreA;
    })[0];
  }
}

// ─── Built-in capabilities ────────────────────────────────────────────────────

export const XLSX_CAPABILITY: ParserCapability = {
  parserType:    "xlsx",
  parserVersion: "1.0.0",

  supportsMultiSheet:   true,
  supportsMultiPage:    false,
  supportsFormulas:     true,
  supportsMergedCells:  true,
  supportsImages:       false,
  supportsHeaders:      true,
  supportsFooters:      true,

  descriptionConfidence: 0.78,
  quantityConfidence:    0.82,
  unitConfidence:        0.70,
  priceConfidence:       0.80,

  limitations: [
    "Células mescladas podem causar deslocamento de colunas",
    "Fórmulas são avaliadas como valor, perdendo a fórmula original",
    "Imagens e gráficos são ignorados",
    "Planilhas protegidas não são acessíveis",
  ],

  requiresManualUnitReview:    true,
  requiresManualPriceReview:   false,
  likelihoodOfMergedHeaders:   0.40,
  likelihoodOfFooterRows:      0.30,

  registeredAt: "2026-05-01T00:00:00.000Z",
};

export const CSV_CAPABILITY: ParserCapability = {
  parserType:    "csv",
  parserVersion: "1.0.0",

  supportsMultiSheet:   false,
  supportsMultiPage:    false,
  supportsFormulas:     false,
  supportsMergedCells:  false,
  supportsImages:       false,
  supportsHeaders:      true,
  supportsFooters:      false,

  descriptionConfidence: 0.72,
  quantityConfidence:    0.75,
  unitConfidence:        0.65,
  priceConfidence:       0.72,

  limitations: [
    "Sem suporte a múltiplas planilhas",
    "Delimitador deve ser detectado automaticamente (vírgula, ponto-e-vírgula, tab)",
    "Encoding pode variar (UTF-8, Latin-1, CP1252)",
    "Cabeçalhos nem sempre presentes ou padronizados",
  ],

  requiresManualUnitReview:    true,
  requiresManualPriceReview:   true,
  likelihoodOfMergedHeaders:   0.05,
  likelihoodOfFooterRows:      0.15,

  registeredAt: "2026-05-01T00:00:00.000Z",
};

export const PDF_CAPABILITY: ParserCapability = {
  parserType:    "pdf",
  parserVersion: "0.1.0",  // stub — OCR não implementado

  supportsMultiSheet:   false,
  supportsMultiPage:    true,
  supportsFormulas:     false,
  supportsMergedCells:  false,
  supportsImages:       false,
  supportsHeaders:      false,
  supportsFooters:      false,

  descriptionConfidence: 0.30,
  quantityConfidence:    0.30,
  unitConfidence:        0.25,
  priceConfidence:       0.30,

  limitations: [
    "STUB: sem OCR implementado nesta versão",
    "Extração de texto apenas em PDFs com texto embutido",
    "Tabelas em PDF raramente têm estrutura semântica detectável",
    "Requer revisão manual obrigatória de todos os campos",
  ],

  requiresManualUnitReview:    true,
  requiresManualPriceReview:   true,
  likelihoodOfMergedHeaders:   0.60,
  likelihoodOfFooterRows:      0.50,

  registeredAt: "2026-05-01T00:00:00.000Z",
};

export const DOCX_CAPABILITY: ParserCapability = {
  parserType:    "docx",
  parserVersion: "0.1.0",  // stub

  supportsMultiSheet:   false,
  supportsMultiPage:    true,
  supportsFormulas:     false,
  supportsMergedCells:  false,
  supportsImages:       false,
  supportsHeaders:      false,
  supportsFooters:      false,

  descriptionConfidence: 0.35,
  quantityConfidence:    0.30,
  unitConfidence:        0.30,
  priceConfidence:       0.30,

  limitations: [
    "STUB: biblioteca DOCX completa não implementada nesta versão",
    "Tabelas em DOCX podem ter estrutura irregular",
    "Campos de descrição longa requerem truncamento",
    "Requer revisão manual obrigatória",
  ],

  requiresManualUnitReview:    true,
  requiresManualPriceReview:   true,
  likelihoodOfMergedHeaders:   0.30,
  likelihoodOfFooterRows:      0.25,

  registeredAt: "2026-05-01T00:00:00.000Z",
};

// ─── Singleton registry com parsers padrão ────────────────────────────────────

export const parserCapabilityRegistry = new ParserCapabilityRegistry()
  .register(XLSX_CAPABILITY)
  .register(CSV_CAPABILITY)
  .register(PDF_CAPABILITY)
  .register(DOCX_CAPABILITY);
