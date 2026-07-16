/**
 * RC-4.3 — Institutional Operating Model · Objetos institucionais (declarativo).
 *
 * Modela os OBJETOS do Departamento de Licitações (DFD, ETP, TR, ...). Cada objeto
 * declara finalidade, entradas, saídas, relacionamentos, estados possíveis e dependências.
 * SEM conteúdo jurídico — apenas o papel operacional do objeto no departamento.
 * Puro e determinístico.
 */

import type { InstitutionalStateId } from "./states";

export type InstitutionalObjectId =
  | "dfd" | "etp" | "tr" | "pesquisa_precos" | "edital" | "aviso" | "sessao" | "ata"
  | "contrato" | "aditivo" | "apostilamento" | "parecer" | "empenho" | "publicacao"
  | "checklist" | "evento" | "processo" | "contratacao_direta";

export type ObjectCategory = "planejamento" | "instrumento" | "sessao" | "contratual" | "juridico" | "controle" | "referencia" | "processo";

export interface InstitutionalObject {
  readonly id: InstitutionalObjectId;
  readonly name: string;
  readonly category: ObjectCategory;
  readonly purpose: string;
  readonly inputs: readonly string[];
  readonly outputs: readonly string[];
  /** Outros objetos aos quais este se relaciona (não jurídico). */
  readonly relationships: readonly InstitutionalObjectId[];
  readonly possibleStates: readonly InstitutionalStateId[];
  /** Objetos dos quais este DEPENDE para existir (dependência operacional). */
  readonly dependsOn: readonly InstitutionalObjectId[];
}

const DOC_STATES: InstitutionalStateId[] = ["em_elaboracao", "em_revisao", "aguardando_aprovacao", "publicado", "arquivado", "cancelado"];

export const INSTITUTIONAL_OBJECTS: Record<InstitutionalObjectId, InstitutionalObject> = {
  processo: {
    id: "processo", name: "Processo Licitatório", category: "processo",
    purpose: "Agrega e organiza todos os artefatos de uma contratação.",
    inputs: ["demanda"], outputs: ["contratação"], relationships: ["dfd", "etp", "tr", "edital", "contrato"],
    possibleStates: ["recebido", "em_elaboracao", "em_execucao", "suspenso", "concluido", "arquivado", "cancelado"], dependsOn: [],
  },
  contratacao_direta: {
    id: "contratacao_direta", name: "Contratação Direta", category: "processo",
    purpose: "Organiza dispensa/inexigibilidade fora do rito licitatório pleno.",
    inputs: ["demanda"], outputs: ["contratação"], relationships: ["dfd", "pesquisa_precos", "parecer", "contrato"],
    possibleStates: ["recebido", "em_elaboracao", "em_execucao", "concluido", "arquivado", "cancelado"], dependsOn: [],
  },
  dfd: {
    id: "dfd", name: "Documento de Formalização da Demanda", category: "planejamento",
    purpose: "Formaliza a demanda que origina a contratação.",
    inputs: ["necessidade do setor requisitante"], outputs: ["demanda formalizada"], relationships: ["etp", "processo"],
    possibleStates: DOC_STATES, dependsOn: ["processo"],
  },
  etp: {
    id: "etp", name: "Estudo Técnico Preliminar", category: "planejamento",
    purpose: "Analisa a viabilidade e o dimensionamento da contratação.",
    inputs: ["dfd"], outputs: ["estudo de viabilidade"], relationships: ["dfd", "tr"], possibleStates: DOC_STATES, dependsOn: ["dfd"],
  },
  tr: {
    id: "tr", name: "Termo de Referência", category: "instrumento",
    purpose: "Define o objeto, requisitos e condições da contratação.",
    inputs: ["etp"], outputs: ["especificação do objeto"], relationships: ["etp", "pesquisa_precos", "edital"], possibleStates: DOC_STATES, dependsOn: ["etp"],
  },
  pesquisa_precos: {
    id: "pesquisa_precos", name: "Pesquisa de Preços", category: "planejamento",
    purpose: "Estabelece a estimativa de preços da contratação.",
    inputs: ["tr"], outputs: ["valor estimado"], relationships: ["tr", "edital"], possibleStates: DOC_STATES, dependsOn: ["tr"],
  },
  edital: {
    id: "edital", name: "Edital", category: "instrumento",
    purpose: "Convoca e disciplina o certame licitatório.",
    inputs: ["tr", "pesquisa_precos"], outputs: ["certame"], relationships: ["tr", "aviso", "sessao"], possibleStates: DOC_STATES, dependsOn: ["tr"],
  },
  aviso: {
    id: "aviso", name: "Aviso", category: "referencia",
    purpose: "Comunica publicamente atos do certame.",
    inputs: ["edital"], outputs: ["comunicação"], relationships: ["edital", "publicacao"], possibleStates: ["em_elaboracao", "publicado", "arquivado"], dependsOn: ["edital"],
  },
  sessao: {
    id: "sessao", name: "Sessão", category: "sessao",
    purpose: "Realiza a disputa/abertura do certame.",
    inputs: ["edital"], outputs: ["resultado da disputa"], relationships: ["edital", "ata"], possibleStates: ["aguardando_aprovacao", "em_execucao", "suspenso", "concluido", "cancelado"], dependsOn: ["edital"],
  },
  ata: {
    id: "ata", name: "Ata", category: "sessao",
    purpose: "Registra formalmente os atos e decisões da sessão.",
    inputs: ["sessao"], outputs: ["registro da sessão"], relationships: ["sessao", "publicacao"], possibleStates: ["em_elaboracao", "publicado", "arquivado"], dependsOn: ["sessao"],
  },
  contrato: {
    id: "contrato", name: "Contrato", category: "contratual",
    purpose: "Formaliza a relação contratual resultante da contratação.",
    inputs: ["processo", "sessao"], outputs: ["vínculo contratual"], relationships: ["aditivo", "apostilamento", "empenho", "processo"],
    possibleStates: ["em_elaboracao", "aguardando_aprovacao", "em_execucao", "suspenso", "concluido", "arquivado", "cancelado"], dependsOn: ["processo"],
  },
  aditivo: {
    id: "aditivo", name: "Termo Aditivo", category: "contratual",
    purpose: "Altera o contrato (prazo, valor, escopo).",
    inputs: ["contrato"], outputs: ["contrato alterado"], relationships: ["contrato"], possibleStates: DOC_STATES, dependsOn: ["contrato"],
  },
  apostilamento: {
    id: "apostilamento", name: "Apostilamento", category: "contratual",
    purpose: "Registra reajustes/anotações que não exigem aditivo.",
    inputs: ["contrato"], outputs: ["anotação contratual"], relationships: ["contrato"], possibleStates: DOC_STATES, dependsOn: ["contrato"],
  },
  parecer: {
    id: "parecer", name: "Parecer", category: "juridico",
    purpose: "Registra apoio técnico-jurídico solicitado ao longo do processo.",
    inputs: ["solicitação"], outputs: ["manifestação"], relationships: ["processo", "contratacao_direta"], possibleStates: DOC_STATES, dependsOn: [],
  },
  empenho: {
    id: "empenho", name: "Empenho (referência)", category: "referencia",
    purpose: "Referência ao empenho orçamentário (fora do escopo — apenas referência).",
    inputs: ["contrato"], outputs: ["referência orçamentária"], relationships: ["contrato"], possibleStates: ["publicado", "arquivado"], dependsOn: ["contrato"],
  },
  publicacao: {
    id: "publicacao", name: "Publicação", category: "referencia",
    purpose: "Dá publicidade a documentos e atos.",
    inputs: ["documento"], outputs: ["ato publicado"], relationships: ["aviso", "ata", "edital"], possibleStates: ["em_elaboracao", "publicado", "arquivado"], dependsOn: [],
  },
  checklist: {
    id: "checklist", name: "Checklist", category: "controle",
    purpose: "Verifica a completude documental e procedimental.",
    inputs: ["processo"], outputs: ["conformidade verificada"], relationships: ["processo"], possibleStates: ["em_elaboracao", "concluido", "arquivado"], dependsOn: ["processo"],
  },
  evento: {
    id: "evento", name: "Evento", category: "controle",
    purpose: "Registra acontecimentos institucionais do processo.",
    inputs: ["ação"], outputs: ["registro de evento"], relationships: ["processo", "contrato"], possibleStates: ["recebido", "arquivado"], dependsOn: [],
  },
};

export const ALL_OBJECT_IDS: InstitutionalObjectId[] = Object.keys(INSTITUTIONAL_OBJECTS) as InstitutionalObjectId[];

export function isInstitutionalObject(id: string): id is InstitutionalObjectId {
  return id in INSTITUTIONAL_OBJECTS;
}

export function getInstitutionalObject(id: InstitutionalObjectId): InstitutionalObject {
  return INSTITUTIONAL_OBJECTS[id];
}
