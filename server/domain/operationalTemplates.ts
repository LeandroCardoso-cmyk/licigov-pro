/**
 * Sprint 3.4 — Operational Templates Domain.
 *
 * Templates operacionais reais de prefeitura para contratacoes comuns.
 * Baseados em boas praticas da Lei 14.133/2021 e modelos do TCU.
 *
 * PRINCIPIOS:
 *   - Global (organizationId=0) ou personalizado por org.
 *   - Versionamento semantico (semver).
 *   - Imutabilidade: customizacao cria novo objeto.
 *   - Multi-tenant.
 */

import type { WorkflowStage } from "./institutionalWorkflow";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TemplateCategoryType =
  | "aquisicao_comum"
  | "medicamentos"
  | "combustivel"
  | "material_expediente"
  | "servicos_terceirizados"
  | "obras"
  | "manutencao"
  | "ti"
  | "alimentacao_escolar"
  | "saude"
  // Sprint 3.5 — novos templates municipais reais
  | "transporte_escolar"
  | "manutencao_frota"
  | "pavimentacao"
  | "merenda_escolar"
  | "exames_laboratoriais"
  | "medicamentos_controlados"
  | "vigilancia_saude"
  | "coleta_lixo"
  | "iluminacao_publica"
  | "assistencia_social";

export interface TemplateVersion {
  version: string;
  changedBy: number;
  changedAt: string;
  description: string;
}

export interface ItemTRTemplate {
  description: string;
  unit: string;
  quantityRange: { min: number; max: number };
  estimatedUnitPriceRange: { min: number; max: number };
  canonicalUnit: string;
  catmatHints: string[];
}

export interface ClauseTemplateRef {
  templateId: string;
  required: boolean;
  order: number;
}

export interface WorkflowTemplateRef {
  stages: WorkflowStage[];
  defaultDeadlineDays: Record<WorkflowStage, number>;
}

export interface OperationalTemplate {
  id: string;
  organizationId: number; // 0 = global
  category: TemplateCategoryType;
  name: string;
  description: string;
  clauseTemplates: ClauseTemplateRef[];
  itemTRTemplates: ItemTRTemplate[];
  workflowTemplate: WorkflowTemplateRef;
  legalBasis: string[]; // artigos Lei 14.133/2021
  estimatedDurationDays: number;
  approvalLevels: number;
  version: string; // semver
  versionHistory: TemplateVersion[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── Default workflow template ────────────────────────────────────────────────

const DEFAULT_WORKFLOW: WorkflowTemplateRef = {
  stages: [
    "elaboration",
    "technical_review",
    "legal_review",
    "authority_approval",
    "director_approval",
    "publication",
    "completed",
  ],
  defaultDeadlineDays: {
    elaboration: 5,
    technical_review: 3,
    legal_review: 3,
    authority_approval: 2,
    director_approval: 2,
    publication: 1,
    completed: 0,
    cancelled: 0,
  },
};

const SIMPLE_WORKFLOW: WorkflowTemplateRef = {
  stages: [
    "elaboration",
    "technical_review",
    "authority_approval",
    "publication",
    "completed",
  ],
  defaultDeadlineDays: {
    elaboration: 3,
    technical_review: 2,
    authority_approval: 1,
    publication: 1,
    completed: 0,
    legal_review: 0,
    director_approval: 0,
    cancelled: 0,
  },
};

// ─── Global templates ─────────────────────────────────────────────────────────

const GLOBAL_TEMPLATES: OperationalTemplate[] = [
  {
    id: "tpl_aquisicao_comum_v1",
    organizationId: 0,
    category: "aquisicao_comum",
    name: "Aquisicao de Bens Comuns",
    description: "Template padrao para aquisicao de bens comuns disponiveis em mercado, conforme art. 6, XIII da Lei 14.133/2021.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_prazo_entrega", required: true, order: 2 },
      { templateId: "clause_garantia", required: false, order: 3 },
    ],
    itemTRTemplates: [
      {
        description: "Material de consumo geral",
        unit: "UN",
        quantityRange: { min: 1, max: 10000 },
        estimatedUnitPriceRange: { min: 1, max: 5000 },
        canonicalUnit: "UN",
        catmatHints: ["999999"],
      },
    ],
    workflowTemplate: SIMPLE_WORKFLOW,
    legalBasis: ["art. 6, XIII", "art. 75, I", "art. 75, II"],
    estimatedDurationDays: 10,
    approvalLevels: 2,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "tpl_medicamentos_v1",
    organizationId: 0,
    category: "medicamentos",
    name: "Aquisicao de Medicamentos",
    description: "Template para aquisicao de medicamentos e insumos de saude, com requisitos ANVISA e controle especial.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_registro_anvisa", required: true, order: 2 },
      { templateId: "clause_prazo_validade", required: true, order: 3 },
      { templateId: "clause_armazenamento", required: true, order: 4 },
    ],
    itemTRTemplates: [
      {
        description: "Medicamento para uso hospitalar",
        unit: "CP",
        quantityRange: { min: 100, max: 100000 },
        estimatedUnitPriceRange: { min: 0.10, max: 500 },
        canonicalUnit: "CP",
        catmatHints: ["389001", "389002", "389003"],
      },
    ],
    workflowTemplate: DEFAULT_WORKFLOW,
    legalBasis: ["art. 6, XIII", "art. 40, I", "Lei 5.991/1973", "RDC ANVISA 204/2017"],
    estimatedDurationDays: 20,
    approvalLevels: 3,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "tpl_combustivel_v1",
    organizationId: 0,
    category: "combustivel",
    name: "Aquisicao de Combustiveis",
    description: "Template para aquisicao de combustiveis para frota municipal, com controle de abastecimento.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_controle_abastecimento", required: true, order: 2 },
      { templateId: "clause_qualidade_combustivel", required: true, order: 3 },
    ],
    itemTRTemplates: [
      {
        description: "Gasolina Comum",
        unit: "L",
        quantityRange: { min: 1000, max: 1000000 },
        estimatedUnitPriceRange: { min: 4, max: 10 },
        canonicalUnit: "L",
        catmatHints: ["10340", "10341"],
      },
      {
        description: "Oleo Diesel S-10",
        unit: "L",
        quantityRange: { min: 1000, max: 1000000 },
        estimatedUnitPriceRange: { min: 5, max: 12 },
        canonicalUnit: "L",
        catmatHints: ["10342", "10343"],
      },
    ],
    workflowTemplate: SIMPLE_WORKFLOW,
    legalBasis: ["art. 6, XIII", "art. 82, VIII", "Portaria INMETRO 116/2013"],
    estimatedDurationDays: 15,
    approvalLevels: 2,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "tpl_material_expediente_v1",
    organizationId: 0,
    category: "material_expediente",
    name: "Material de Expediente",
    description: "Template para aquisicao de materiais de escritorio e expediente para uso administrativo.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_prazo_entrega", required: true, order: 2 },
    ],
    itemTRTemplates: [
      {
        description: "Papel A4 75g/m2",
        unit: "RM",
        quantityRange: { min: 10, max: 5000 },
        estimatedUnitPriceRange: { min: 20, max: 60 },
        canonicalUnit: "RM",
        catmatHints: ["381001"],
      },
      {
        description: "Caneta esferografica azul",
        unit: "CX",
        quantityRange: { min: 1, max: 500 },
        estimatedUnitPriceRange: { min: 5, max: 30 },
        canonicalUnit: "CX",
        catmatHints: ["381100"],
      },
    ],
    workflowTemplate: SIMPLE_WORKFLOW,
    legalBasis: ["art. 75, I", "art. 75, II"],
    estimatedDurationDays: 7,
    approvalLevels: 2,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "tpl_servicos_terceirizados_v1",
    organizationId: 0,
    category: "servicos_terceirizados",
    name: "Servicos Terceirizados",
    description: "Template para contratacao de servicos terceirizados (limpeza, vigilancia, zeladoria), com clausulas de fiscalizacao.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_fiscalizacao", required: true, order: 2 },
      { templateId: "clause_encargos_trabalhistas", required: true, order: 3 },
      { templateId: "clause_subcontratacao", required: false, order: 4 },
    ],
    itemTRTemplates: [
      {
        description: "Servico de Limpeza e Conservacao",
        unit: "M2/MES",
        quantityRange: { min: 100, max: 50000 },
        estimatedUnitPriceRange: { min: 5, max: 30 },
        canonicalUnit: "M2/MES",
        catmatHints: ["540001", "540002"],
      },
    ],
    workflowTemplate: DEFAULT_WORKFLOW,
    legalBasis: ["art. 6, XVI", "art. 92", "IN SEGES/ME 05/2017", "Sumula TST 331"],
    estimatedDurationDays: 30,
    approvalLevels: 3,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "tpl_obras_v1",
    organizationId: 0,
    category: "obras",
    name: "Obras e Servicos de Engenharia",
    description: "Template para contratacao de obras e servicos de engenharia, incluindo projeto basico e ART/RRT.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_projeto_basico", required: true, order: 2 },
      { templateId: "clause_cronograma_fisico", required: true, order: 3 },
      { templateId: "clause_medicao", required: true, order: 4 },
      { templateId: "clause_garantia_execucao", required: true, order: 5 },
    ],
    itemTRTemplates: [
      {
        description: "Servico de engenharia civil",
        unit: "M2",
        quantityRange: { min: 10, max: 100000 },
        estimatedUnitPriceRange: { min: 500, max: 5000 },
        canonicalUnit: "M2",
        catmatHints: ["920001", "920002"],
      },
    ],
    workflowTemplate: DEFAULT_WORKFLOW,
    legalBasis: ["art. 6, I", "art. 46", "art. 47", "art. 69", "Lei 5.194/1966"],
    estimatedDurationDays: 45,
    approvalLevels: 4,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "tpl_manutencao_v1",
    organizationId: 0,
    category: "manutencao",
    name: "Servicos de Manutencao",
    description: "Template para contratacao de servicos de manutencao preventiva e corretiva de equipamentos e instalacoes.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_nivel_servico", required: true, order: 2 },
      { templateId: "clause_tempo_resposta", required: true, order: 3 },
    ],
    itemTRTemplates: [
      {
        description: "Manutencao preventiva de ar condicionado",
        unit: "UNID",
        quantityRange: { min: 1, max: 1000 },
        estimatedUnitPriceRange: { min: 100, max: 1000 },
        canonicalUnit: "UNID",
        catmatHints: ["630001", "630002"],
      },
    ],
    workflowTemplate: SIMPLE_WORKFLOW,
    legalBasis: ["art. 6, XVI", "art. 78", "NBR ISO 9001"],
    estimatedDurationDays: 20,
    approvalLevels: 2,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "tpl_ti_v1",
    organizationId: 0,
    category: "ti",
    name: "Tecnologia da Informacao",
    description: "Template para aquisicao de bens e servicos de TI, conforme IN SGD/ME 01/2019 e PDTI.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_especificacoes_tecnicas_ti", required: true, order: 2 },
      { templateId: "clause_propriedade_intelectual", required: true, order: 3 },
      { templateId: "clause_seguranca_informacao", required: true, order: 4 },
    ],
    itemTRTemplates: [
      {
        description: "Licenca de software",
        unit: "UN",
        quantityRange: { min: 1, max: 10000 },
        estimatedUnitPriceRange: { min: 50, max: 50000 },
        canonicalUnit: "UN",
        catmatHints: ["480001", "480002"],
      },
    ],
    workflowTemplate: DEFAULT_WORKFLOW,
    legalBasis: ["art. 6, XIII", "IN SGD/ME 01/2019", "LGPD (Lei 13.709/2018)"],
    estimatedDurationDays: 25,
    approvalLevels: 3,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "tpl_alimentacao_escolar_v1",
    organizationId: 0,
    category: "alimentacao_escolar",
    name: "Alimentacao Escolar (PNAE)",
    description: "Template para aquisicao de generos alimenticios para alimentacao escolar, observando PNAE (Lei 11.947/2009) e 30% da AF.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_cardapio_nutricional", required: true, order: 2 },
      { templateId: "clause_agricultura_familiar", required: true, order: 3 },
      { templateId: "clause_controle_qualidade_alimentos", required: true, order: 4 },
    ],
    itemTRTemplates: [
      {
        description: "Genero alimenticio — hortifruti",
        unit: "KG",
        quantityRange: { min: 100, max: 100000 },
        estimatedUnitPriceRange: { min: 1, max: 50 },
        canonicalUnit: "KG",
        catmatHints: ["210001", "210002", "210003"],
      },
    ],
    workflowTemplate: DEFAULT_WORKFLOW,
    legalBasis: ["art. 6, XIII", "Lei 11.947/2009", "Resolucao FNDE/CD 06/2020"],
    estimatedDurationDays: 20,
    approvalLevels: 3,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  {
    id: "tpl_saude_v1",
    organizationId: 0,
    category: "saude",
    name: "Servicos e Insumos de Saude",
    description: "Template para contratacao de servicos e aquisicao de insumos de saude, com requisitos regulatorios.",
    clauseTemplates: [
      { templateId: "clause_objeto", required: true, order: 1 },
      { templateId: "clause_habilitacao_sanitaria", required: true, order: 2 },
      { templateId: "clause_controle_qualidade", required: true, order: 3 },
      { templateId: "clause_rastreabilidade", required: true, order: 4 },
    ],
    itemTRTemplates: [
      {
        description: "Material hospitalar descartavel",
        unit: "CX",
        quantityRange: { min: 10, max: 10000 },
        estimatedUnitPriceRange: { min: 10, max: 5000 },
        canonicalUnit: "CX",
        catmatHints: ["389100", "389200"],
      },
    ],
    workflowTemplate: DEFAULT_WORKFLOW,
    legalBasis: ["art. 6, XIII", "Lei 8.080/1990", "RDC ANVISA 27/2012"],
    estimatedDurationDays: 25,
    approvalLevels: 3,
    version: "1.0.0",
    versionHistory: [],
    active: true,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  },
  // ── Sprint 3.5: Novos templates municipais reais ─────────────────────────
  {
    id:             "tpl_transporte_escolar_v1",
    organizationId: 0,
    category:       "transporte_escolar",
    name:           "Contratacao de Transporte Escolar",
    description:    "Template para contratacao de servicos de transporte escolar municipal (PNATE/PETE).",
    clauseTemplates: [
      { templateId: "clause_objeto",             required: true,  order: 1 },
      { templateId: "clause_habilitacao_veiculo", required: true, order: 2 },
      { templateId: "clause_motorista_monitor",  required: true,  order: 3 },
      { templateId: "clause_seguro",             required: true,  order: 4 },
      { templateId: "clause_prazo",              required: true,  order: 5 },
    ],
    itemTRTemplates: [
      {
        description:             "Servico de transporte escolar por rota",
        unit:                    "MES",
        quantityRange:           { min: 12, max: 60 },
        estimatedUnitPriceRange: { min: 3000, max: 30000 },
        canonicalUnit:           "MES",
        catmatHints:             ["transporte_escolar", "onibus", "van_escolar"],
      },
    ],
    workflowTemplate:     DEFAULT_WORKFLOW,
    legalBasis:           ["Art. 6, XXIII", "Lei 10.880/2004 (PNATE)", "Art. 74"],
    estimatedDurationDays: 45,
    approvalLevels:       3,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
  {
    id:             "tpl_manutencao_frota_v1",
    organizationId: 0,
    category:       "manutencao_frota",
    name:           "Manutencao de Frota Municipal",
    description:    "Template para manutencao preventiva e corretiva de veiculos e maquinas da frota municipal.",
    clauseTemplates: [
      { templateId: "clause_objeto",              required: true,  order: 1 },
      { templateId: "clause_especificacao_tecnica", required: true, order: 2 },
      { templateId: "clause_pecas_originais",     required: true,  order: 3 },
      { templateId: "clause_prazo",               required: true,  order: 4 },
    ],
    itemTRTemplates: [
      {
        description:             "Manutencao preventiva de veiculo leve",
        unit:                    "UN",
        quantityRange:           { min: 5, max: 200 },
        estimatedUnitPriceRange: { min: 300, max: 5000 },
        canonicalUnit:           "UN",
        catmatHints:             ["manutencao_veiculo", "frota", "revisao_periodica"],
      },
    ],
    workflowTemplate:     DEFAULT_WORKFLOW,
    legalBasis:           ["Art. 6, XXIII", "Art. 74, I"],
    estimatedDurationDays: 25,
    approvalLevels:       2,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
  {
    id:             "tpl_pavimentacao_v1",
    organizationId: 0,
    category:       "pavimentacao",
    name:           "Pavimentacao e Recuperacao de Vias",
    description:    "Template para obras de pavimentacao asfaltica, recapeamento e recuperacao de vias urbanas.",
    clauseTemplates: [
      { templateId: "clause_objeto",             required: true,  order: 1 },
      { templateId: "clause_projeto_basico",     required: true,  order: 2 },
      { templateId: "clause_habilitacao_tecnica", required: true, order: 3 },
      { templateId: "clause_medicao",            required: true,  order: 4 },
      { templateId: "clause_garantia",           required: true,  order: 5 },
    ],
    itemTRTemplates: [
      {
        description:             "Pavimentacao asfaltica (CBUQ)",
        unit:                    "M2",
        quantityRange:           { min: 500, max: 500000 },
        estimatedUnitPriceRange: { min: 80, max: 350 },
        canonicalUnit:           "M2",
        catmatHints:             ["pavimentacao", "asfalto", "CBUQ", "recapeamento"],
      },
    ],
    workflowTemplate: {
      stages:              ["elaboration", "technical_review", "legal_review", "authority_approval", "director_approval", "publication", "completed"],
      defaultDeadlineDays: { elaboration: 20, technical_review: 15, legal_review: 10, authority_approval: 7, director_approval: 5, publication: 3, completed: 0 },
    },
    legalBasis:           ["Art. 6, I", "Art. 8", "Art. 46", "Art. 47"],
    estimatedDurationDays: 120,
    approvalLevels:       4,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
  {
    id:             "tpl_merenda_escolar_v1",
    organizationId: 0,
    category:       "merenda_escolar",
    name:           "Aquisicao de Merenda Escolar",
    description:    "Template para aquisicao de generos alimenticios para merenda escolar via PNAE.",
    clauseTemplates: [
      { templateId: "clause_objeto",               required: true,  order: 1 },
      { templateId: "clause_nutricional",          required: true,  order: 2 },
      { templateId: "clause_agricultura_familiar", required: false, order: 3 },
      { templateId: "clause_controle_qualidade",   required: true,  order: 4 },
    ],
    itemTRTemplates: [
      {
        description:             "Kit merenda escolar mensal",
        unit:                    "KIT",
        quantityRange:           { min: 100, max: 50000 },
        estimatedUnitPriceRange: { min: 20, max: 200 },
        canonicalUnit:           "KIT",
        catmatHints:             ["merenda", "pnae", "kit_alimentar", "generos_alimenticios"],
      },
    ],
    workflowTemplate:     DEFAULT_WORKFLOW,
    legalBasis:           ["Lei 11.947/2009", "Resolucao CD/FNDE 06/2020", "Art. 6, XXIII"],
    estimatedDurationDays: 30,
    approvalLevels:       3,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
  {
    id:             "tpl_exames_laboratoriais_v1",
    organizationId: 0,
    category:       "exames_laboratoriais",
    name:           "Contratacao de Exames Laboratoriais",
    description:    "Template para contratacao de servicos de diagnostico laboratorial para a rede publica de saude.",
    clauseTemplates: [
      { templateId: "clause_objeto",              required: true,  order: 1 },
      { templateId: "clause_habilitacao_anvisa",  required: true,  order: 2 },
      { templateId: "clause_prazo_entrega",       required: true,  order: 3 },
      { templateId: "clause_controle_qualidade",  required: true,  order: 4 },
    ],
    itemTRTemplates: [
      {
        description:             "Exame laboratorial - hemograma completo",
        unit:                    "UN",
        quantityRange:           { min: 100, max: 100000 },
        estimatedUnitPriceRange: { min: 5, max: 80 },
        canonicalUnit:           "UN",
        catmatHints:             ["exame_laboratorial", "diagnostico", "saude_publica"],
      },
    ],
    workflowTemplate:     DEFAULT_WORKFLOW,
    legalBasis:           ["Art. 6, XXIII", "RDC ANVISA", "Portaria GM/MS"],
    estimatedDurationDays: 35,
    approvalLevels:       3,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
  {
    id:             "tpl_medicamentos_controlados_v1",
    organizationId: 0,
    category:       "medicamentos_controlados",
    name:           "Aquisicao de Medicamentos Controlados",
    description:    "Template para aquisicao de medicamentos sujeitos a controle especial (portaria 344/98).",
    clauseTemplates: [
      { templateId: "clause_objeto",                  required: true,  order: 1 },
      { templateId: "clause_registro_anvisa",         required: true,  order: 2 },
      { templateId: "clause_autorizacao_especial",    required: true,  order: 3 },
      { templateId: "clause_rastreabilidade",         required: true,  order: 4 },
      { templateId: "clause_prazo",                   required: true,  order: 5 },
    ],
    itemTRTemplates: [
      {
        description:             "Medicamento controlado conforme lista",
        unit:                    "CX",
        quantityRange:           { min: 10, max: 5000 },
        estimatedUnitPriceRange: { min: 10, max: 2000 },
        canonicalUnit:           "CX",
        catmatHints:             ["medicamento_controlado", "psicoleptico", "portaria_344"],
      },
    ],
    workflowTemplate:     DEFAULT_WORKFLOW,
    legalBasis:           ["Art. 6, XXIII", "Portaria SVS/MS 344/98", "Art. 18"],
    estimatedDurationDays: 40,
    approvalLevels:       4,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
  {
    id:             "tpl_vigilancia_saude_v1",
    organizationId: 0,
    category:       "vigilancia_saude",
    name:           "Contratacao de Servicos de Vigilancia em Saude",
    description:    "Template para contratacao de servicos de vigilancia sanitaria, epidemiologica e ambiental.",
    clauseTemplates: [
      { templateId: "clause_objeto",              required: true, order: 1 },
      { templateId: "clause_especificacao_tecnica", required: true, order: 2 },
      { templateId: "clause_responsabilidade_tecnica", required: true, order: 3 },
      { templateId: "clause_prazo",               required: true, order: 4 },
    ],
    itemTRTemplates: [
      {
        description:             "Servico de vigilancia sanitaria municipal",
        unit:                    "MES",
        quantityRange:           { min: 12, max: 60 },
        estimatedUnitPriceRange: { min: 2000, max: 50000 },
        canonicalUnit:           "MES",
        catmatHints:             ["vigilancia_sanitaria", "epidemiologia", "saude_ambiental"],
      },
    ],
    workflowTemplate:     DEFAULT_WORKFLOW,
    legalBasis:           ["Lei 8.080/1990", "Art. 6, XXIII", "Portaria MS"],
    estimatedDurationDays: 40,
    approvalLevels:       3,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
  {
    id:             "tpl_coleta_lixo_v1",
    organizationId: 0,
    category:       "coleta_lixo",
    name:           "Contratacao de Coleta e Destinacao de Residuos",
    description:    "Template para contratacao de servicos de coleta, transporte e destinacao final de residuos solidos urbanos.",
    clauseTemplates: [
      { templateId: "clause_objeto",              required: true,  order: 1 },
      { templateId: "clause_especificacao_tecnica", required: true, order: 2 },
      { templateId: "clause_destinacao_final",    required: true,  order: 3 },
      { templateId: "clause_licenca_ambiental",   required: true,  order: 4 },
      { templateId: "clause_prazo",               required: true,  order: 5 },
    ],
    itemTRTemplates: [
      {
        description:             "Coleta domiciliar de residuos solidos",
        unit:                    "TON",
        quantityRange:           { min: 100, max: 500000 },
        estimatedUnitPriceRange: { min: 150, max: 600 },
        canonicalUnit:           "TON",
        catmatHints:             ["coleta_lixo", "residuos_solidos", "aterro_sanitario"],
      },
    ],
    workflowTemplate:     DEFAULT_WORKFLOW,
    legalBasis:           ["Lei 12.305/2010 (PNRS)", "Art. 6, XXIII", "Art. 74"],
    estimatedDurationDays: 60,
    approvalLevels:       3,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
  {
    id:             "tpl_iluminacao_publica_v1",
    organizationId: 0,
    category:       "iluminacao_publica",
    name:           "Servicos de Iluminacao Publica",
    description:    "Template para manutencao e expansao da rede de iluminacao publica municipal.",
    clauseTemplates: [
      { templateId: "clause_objeto",              required: true, order: 1 },
      { templateId: "clause_especificacao_tecnica", required: true, order: 2 },
      { templateId: "clause_art_crea",            required: true, order: 3 },
      { templateId: "clause_prazo",               required: true, order: 4 },
    ],
    itemTRTemplates: [
      {
        description:             "Manutencao de ponto de iluminacao publica",
        unit:                    "UN",
        quantityRange:           { min: 10, max: 50000 },
        estimatedUnitPriceRange: { min: 50, max: 800 },
        canonicalUnit:           "UN",
        catmatHints:             ["iluminacao_publica", "LED", "lampada", "poste"],
      },
    ],
    workflowTemplate:     DEFAULT_WORKFLOW,
    legalBasis:           ["Art. 6, XXIII", "Resolucao ANEEL", "NBR 5101"],
    estimatedDurationDays: 30,
    approvalLevels:       2,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
  {
    id:             "tpl_assistencia_social_v1",
    organizationId: 0,
    category:       "assistencia_social",
    name:           "Contratacao de Servicos de Assistencia Social",
    description:    "Template para contratacao de servicos socioassistenciais (SUAS) — CRAS, CREAS e servicos complementares.",
    clauseTemplates: [
      { templateId: "clause_objeto",               required: true, order: 1 },
      { templateId: "clause_habilitacao_tecnica",  required: true, order: 2 },
      { templateId: "clause_metas_sociais",        required: true, order: 3 },
      { templateId: "clause_prazo",                required: true, order: 4 },
      { templateId: "clause_monitoramento",        required: true, order: 5 },
    ],
    itemTRTemplates: [
      {
        description:             "Servico socioassistencial CRAS/CREAS",
        unit:                    "MES",
        quantityRange:           { min: 12, max: 60 },
        estimatedUnitPriceRange: { min: 5000, max: 100000 },
        canonicalUnit:           "MES",
        catmatHints:             ["assistencia_social", "CRAS", "CREAS", "SUAS"],
      },
    ],
    workflowTemplate:     DEFAULT_WORKFLOW,
    legalBasis:           ["Lei 8.742/1993 (LOAS)", "Art. 6, XXIII", "NOB/SUAS 2012"],
    estimatedDurationDays: 45,
    approvalLevels:       3,
    version:              "1.0.0",
    versionHistory:       [],
    active:               true,
    createdAt:            "2025-01-01T00:00:00.000Z",
    updatedAt:            "2025-01-01T00:00:00.000Z",
  },
];

// ─── Functions ────────────────────────────────────────────────────────────────

export function getGlobalTemplates(): OperationalTemplate[] {
  return GLOBAL_TEMPLATES.map(t => ({ ...t }));
}

export function getTemplateByCategory(category: TemplateCategoryType): OperationalTemplate | null {
  const found = GLOBAL_TEMPLATES.find(t => t.category === category);
  return found ? { ...found } : null;
}

export function customizeTemplate(
  template: OperationalTemplate,
  orgId: number,
  overrides: Partial<Omit<OperationalTemplate, "id" | "organizationId" | "version" | "versionHistory" | "createdAt" | "updatedAt">>,
): OperationalTemplate {
  const now = new Date().toISOString();
  return {
    ...template,
    ...overrides,
    id: `tpl_${orgId}_${template.category}_v1`,
    organizationId: orgId,
    version: template.version, // preserve version
    versionHistory: [...template.versionHistory],
    createdAt: now,
    updatedAt: now,
  };
}

export function bumpTemplateVersion(
  template: OperationalTemplate,
  changeDescription: string,
  changedBy: number,
): OperationalTemplate {
  const [major, minor, patch] = template.version.split(".").map(Number);
  const newVersion = `${major}.${minor}.${(patch ?? 0) + 1}`;
  const now = new Date().toISOString();

  const entry: TemplateVersion = {
    version: template.version,
    changedBy,
    changedAt: now,
    description: changeDescription,
  };

  return {
    ...template,
    version: newVersion,
    versionHistory: [...template.versionHistory, entry],
    updatedAt: now,
  };
}

export function mergeTemplates(
  base: OperationalTemplate,
  override: Partial<OperationalTemplate>,
): OperationalTemplate {
  const now = new Date().toISOString();
  return {
    ...base,
    ...override,
    // merge arrays by preferring override if provided
    clauseTemplates: override.clauseTemplates ?? base.clauseTemplates,
    itemTRTemplates: override.itemTRTemplates ?? base.itemTRTemplates,
    legalBasis: override.legalBasis ?? base.legalBasis,
    versionHistory: [
      ...base.versionHistory,
      ...(override.versionHistory ?? []),
    ],
    updatedAt: now,
  };
}

export function validateTemplate(template: OperationalTemplate): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!template.id || template.id.trim() === "") {
    errors.push("Template id is required.");
  }
  if (!template.name || template.name.trim() === "") {
    errors.push("Template name is required.");
  }
  if (!template.category) {
    errors.push("Template category is required.");
  }
  if (!template.version || !/^\d+\.\d+\.\d+$/.test(template.version)) {
    errors.push("Template version must be valid semver (e.g. 1.0.0).");
  }
  if (template.estimatedDurationDays < 1) {
    errors.push("estimatedDurationDays must be >= 1.");
  }
  if (template.approvalLevels < 1) {
    errors.push("approvalLevels must be >= 1.");
  }
  if (!template.legalBasis || template.legalBasis.length === 0) {
    errors.push("At least one legalBasis reference is required.");
  }
  if (!template.workflowTemplate || template.workflowTemplate.stages.length === 0) {
    errors.push("workflowTemplate.stages must not be empty.");
  }

  return { valid: errors.length === 0, errors };
}

export function getTemplateProvenance(template: OperationalTemplate): {
  source: "global" | "customized";
  baseVersion: string;
  customizations: string[];
} {
  const isGlobal = template.organizationId === 0;
  const customizations: string[] = [];

  if (!isGlobal) {
    // Detect differences from global template
    const globalTemplate = GLOBAL_TEMPLATES.find(t => t.category === template.category);
    if (globalTemplate) {
      if (template.name !== globalTemplate.name) customizations.push("name");
      if (template.description !== globalTemplate.description) customizations.push("description");
      if (template.estimatedDurationDays !== globalTemplate.estimatedDurationDays) customizations.push("estimatedDurationDays");
      if (template.approvalLevels !== globalTemplate.approvalLevels) customizations.push("approvalLevels");
      if (JSON.stringify(template.clauseTemplates) !== JSON.stringify(globalTemplate.clauseTemplates)) customizations.push("clauseTemplates");
      if (JSON.stringify(template.itemTRTemplates) !== JSON.stringify(globalTemplate.itemTRTemplates)) customizations.push("itemTRTemplates");
      if (JSON.stringify(template.legalBasis) !== JSON.stringify(globalTemplate.legalBasis)) customizations.push("legalBasis");
    }
  }

  const baseVersion = template.versionHistory.length > 0
    ? template.versionHistory[0].version
    : template.version;

  return {
    source: isGlobal ? "global" : "customized",
    baseVersion,
    customizations,
  };
}
