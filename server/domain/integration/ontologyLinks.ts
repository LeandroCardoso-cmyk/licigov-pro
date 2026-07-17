/**
 * RC-4.4.1 — Ontology Integration Layer · Ligações entre ontologias (declarativo).
 *
 * Liga elementos da Ontologia Operacional (papéis/objetos/estados/eventos) a elementos da
 * Ontologia Jurídica (conceitos/estruturas/classificações). Cada ligação é EXPLICÁVEL
 * (origem, destino, tipo, motivo, categoria) — nunca implícita. Sem conteúdo jurídico.
 * Puro e determinístico. Baixo acoplamento: importa das duas ontologias; elas não importam esta.
 */

import { createHash } from "crypto";
import type { SemanticLinkTypeId } from "./semanticLinkTypes";

/** Referência a um elemento de uma das ontologias. */
export type OperatingRefKind = "role" | "object" | "state" | "event";
export type LegalRefKind = "concept" | "structure" | "classification" | "norm_type";

export interface OntologyRef {
  readonly domain: "operating" | "legal";
  readonly kind: OperatingRefKind | LegalRefKind;
  readonly id: string;
}

export interface SemanticLink {
  readonly id: string;
  readonly linkType: SemanticLinkTypeId;
  readonly from: OntologyRef;
  readonly to: OntologyRef;
  /** Explainability (Part 8): motivo declarado da ligação. */
  readonly reason: string;
  readonly category: string;
}

const op = (kind: OperatingRefKind, id: string): OntologyRef => ({ domain: "operating", kind, id });
const lg = (kind: LegalRefKind, id: string): OntologyRef => ({ domain: "legal", kind, id });

function linkId(linkType: string, from: OntologyRef, to: OntologyRef): string {
  return createHash("sha256").update(`link:${linkType}:${from.domain}.${from.kind}.${from.id}:${to.domain}.${to.kind}.${to.id}`).digest("hex").slice(0, 20);
}

function mk(linkType: SemanticLinkTypeId, from: OntologyRef, to: OntologyRef, reason: string, category: string): SemanticLink {
  return { id: linkId(linkType, from, to), linkType, from, to, reason, category };
}

export const SEMANTIC_LINKS: readonly SemanticLink[] = [
  // Papéis → Conceitos jurídicos
  mk("exige", op("role", "agente_contratacao"), lg("concept", "competencia"), "O agente de contratação atua sob competência atribuída.", "papel_conceito"),
  mk("representa", op("role", "autoridade_competente"), lg("concept", "competencia"), "A autoridade competente representa a competência decisória.", "papel_conceito"),
  mk("fundamenta", op("role", "assessoria_juridica"), lg("concept", "fundamentacao"), "A assessoria jurídica produz fundamentação.", "papel_conceito"),
  mk("valida", op("role", "controle_interno"), lg("concept", "requisito"), "O controle interno valida requisitos.", "papel_conceito"),
  mk("fiscaliza", op("role", "fiscal_contrato"), lg("concept", "procedimento"), "O fiscal fiscaliza o procedimento de execução.", "papel_conceito"),
  mk("controla", op("role", "gestor_contrato"), lg("concept", "procedimento"), "O gestor controla o procedimento contratual.", "papel_conceito"),

  // Objetos → Conceitos
  mk("materializa", op("object", "tr"), lg("concept", "requisito"), "O TR materializa requisitos do objeto.", "objeto_conceito"),
  mk("exige", op("object", "tr"), lg("concept", "criterio"), "O TR exige critérios de julgamento/aceitação.", "objeto_conceito"),
  mk("materializa", op("object", "contrato"), lg("concept", "obrigacao"), "O contrato materializa obrigações.", "objeto_conceito"),
  mk("exige", op("object", "edital"), lg("concept", "procedimento"), "O edital exige um procedimento de certame.", "objeto_conceito"),
  mk("origina", op("object", "dfd"), lg("concept", "hipotese"), "O DFD origina a hipótese de contratação.", "objeto_conceito"),
  mk("fundamenta", op("object", "parecer"), lg("concept", "fundamentacao"), "O parecer produz fundamentação.", "objeto_conceito"),
  mk("exige", op("object", "aditivo"), lg("concept", "condicao"), "O aditivo exige condição para alteração.", "objeto_conceito"),

  // Estados → Hipóteses/condições
  mk("relaciona_se", op("state", "publicado"), lg("concept", "hipotese"), "O estado publicado relaciona-se a hipóteses aplicáveis.", "estado_conceito"),
  mk("relaciona_se", op("state", "suspenso"), lg("concept", "condicao"), "A suspensão relaciona-se a condições.", "estado_conceito"),
  mk("relaciona_se", op("state", "cancelado"), lg("concept", "excecao"), "O cancelamento relaciona-se a exceções.", "estado_conceito"),

  // Eventos → Procedimentos
  mk("executa", op("event", "sessao"), lg("concept", "procedimento"), "A sessão executa um procedimento.", "evento_conceito"),
  mk("executa", op("event", "publicacao"), lg("concept", "procedimento"), "A publicação executa um procedimento de publicidade.", "evento_conceito"),
  mk("materializa", op("event", "assinatura"), lg("concept", "obrigacao"), "A assinatura materializa a obrigação contratual.", "evento_conceito"),
  mk("exige", op("event", "rescisao"), lg("concept", "condicao"), "A rescisão exige condição.", "evento_conceito"),

  // Dependências → Obrigações
  mk("exige", op("object", "etp"), lg("concept", "obrigacao"), "A dependência do ETP em relação ao DFD materializa uma obrigação procedimental.", "dependencia_obrigacao"),
  mk("exige", op("object", "tr"), lg("concept", "obrigacao"), "A dependência do TR em relação ao ETP materializa uma obrigação procedimental.", "dependencia_obrigacao"),

  // Relacionamentos → Competências
  mk("exige", op("object", "edital"), lg("concept", "competencia"), "A aprovação do edital exige competência da autoridade.", "relacionamento_competencia"),
  mk("exige", op("object", "processo"), lg("concept", "competencia"), "A condução do processo exige competência do departamento.", "relacionamento_competencia"),

  // Objetos → Estrutura/Classificação (cross-domínio adicional)
  mk("encapsula", op("object", "tr"), lg("structure", "artigo"), "O TR encapsula estrutura articulada de especificações.", "objeto_estrutura"),
  mk("relaciona_se", op("object", "parecer"), lg("classification", "parecer"), "O objeto parecer relaciona-se à classificação de parecer.", "objeto_classificacao"),
];

export const ALL_LINK_IDS: string[] = SEMANTIC_LINKS.map(l => l.id);

export function getLink(id: string): SemanticLink | null { return SEMANTIC_LINKS.find(l => l.id === id) ?? null; }
