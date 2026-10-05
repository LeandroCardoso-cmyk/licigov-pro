/**
 * FASE 5 — Business Domain: Contratação Direta
 *
 * DirectProcurementWorkspace conduz INTEGRALMENTE um processo de Dispensa ou
 * Inexigibilidade — do início até o contrato/instrumento equivalente. Cada etapa
 * é um ESTADO; o Adaptive Process Engine decide quais etapas são obrigatórias
 * (DFD opcional, pesquisa/propostas/parecer condicionais). Nunca fluxo fixo.
 *
 * Reutiliza integralmente a infraestrutura do Kernel (Price Research, Institutional
 * Request Engine, Parecer Jurídico). Determinístico, multi-tenant, replay-safe.
 */

import { createHash } from "crypto";
import type { CopilotType } from "./institutionalCopilot";

export type DirectProcurementType = "dispensa" | "inexigibilidade";
export type DirectProcedureType = "eletronico" | "presencial" | "indefinido";

/** Como o servidor deseja iniciar (DFD é sempre opcional). */
export type DirectStartOption =
  | "criar_dfd"
  | "importar_dfd"
  | "importar_pdf"
  | "importar_memorando"
  | "importar_oficio"
  | "sem_dfd";

export type DirectProcurementStage =
  | "NEW"
  | "DFD"
  | "LEGAL_BASIS"
  | "NEED_CHARACTERIZATION"
  | "PRICE_RESEARCH"
  | "PROCEDURE"
  | "PROPOSAL_COLLECTION"
  | "CONTRACT_JUSTIFICATION"
  | "PRICE_JUSTIFICATION"
  | "REQUIRED_DOCUMENTS"
  | "LEGAL_OPINION"
  | "RATIFICATION"
  | "PUBLICATION"
  | "CONTRACT"
  | "ARCHIVED";

export type DirectProcurementStatus = "rascunho" | "em_andamento" | "aguardando_parecer" | "ratificado" | "publicado" | "concluido" | "arquivado";

/** Ordem canônica das etapas. */
export const DIRECT_STAGE_ORDER: DirectProcurementStage[] = [
  "NEW", "DFD", "LEGAL_BASIS", "NEED_CHARACTERIZATION", "PRICE_RESEARCH", "PROCEDURE",
  "PROPOSAL_COLLECTION", "CONTRACT_JUSTIFICATION", "PRICE_JUSTIFICATION", "REQUIRED_DOCUMENTS",
  "LEGAL_OPINION", "RATIFICATION", "PUBLICATION", "CONTRACT", "ARCHIVED",
];

/** Copilotos do domínio (coordenados apenas pelo Multi-Copilot Orchestrator). */
export const DIRECT_DOMAIN_COPILOTS: CopilotType[] = ["agente_contratacao", "juridico", "pesquisa_precos"];

/** Etapas condicionais controladas pelo Adaptive Process Engine. */
export interface AdaptiveFlags {
  readonly usesDFD: boolean;
  readonly requiresPriceResearch: boolean;
  readonly requiresProposalCollection: boolean;
  readonly requiresLegalOpinion: boolean;
}

export interface DirectProcurementWorkspace {
  readonly id: string;
  readonly organizationId: number;
  readonly processNumber: string;
  readonly object: string;
  readonly procurementType: DirectProcurementType;
  readonly procedureType: DirectProcedureType;
  readonly legalBasis: string;
  readonly startOption: DirectStartOption;
  readonly currentStage: DirectProcurementStage;
  readonly status: DirectProcurementStatus;
  readonly responsibleUser: number;
  readonly participants: readonly number[];
  readonly activeCopilots: readonly CopilotType[];
  readonly flags: AdaptiveFlags;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Flags padrão por modalidade (Adaptive Process Engine — nunca fluxo fixo). */
export function defaultFlags(type: DirectProcurementType, startOption: DirectStartOption): AdaptiveFlags {
  return {
    usesDFD: startOption !== "sem_dfd",
    // Dispensa por valor exige pesquisa; inexigibilidade (inviabilidade de competição) em regra não.
    requiresPriceResearch: type === "dispensa",
    requiresProposalCollection: type === "dispensa",
    requiresLegalOpinion: true,
  };
}

export function createDirectProcurementWorkspace(params: {
  organizationId: number;
  processNumber: string;
  object: string;
  procurementType: DirectProcurementType;
  startOption: DirectStartOption;
  responsibleUser: number;
  participants?: number[];
  legalBasis?: string;
  flags?: Partial<AdaptiveFlags>;
  correlationId: string;
  createdAt?: string;
}): DirectProcurementWorkspace {
  const id = createHash("sha256")
    .update(`dpw:${params.organizationId}:${params.processNumber}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  const flags = { ...defaultFlags(params.procurementType, params.startOption), ...params.flags };
  // Sem DFD, o fluxo começa direto na definição do Fundamento Legal.
  const currentStage: DirectProcurementStage = flags.usesDFD ? "NEW" : "LEGAL_BASIS";
  return {
    id,
    organizationId: params.organizationId,
    processNumber: params.processNumber,
    object: params.object,
    procurementType: params.procurementType,
    procedureType: "indefinido",
    legalBasis: params.legalBasis ?? "",
    startOption: params.startOption,
    currentStage,
    status: "rascunho",
    responsibleUser: params.responsibleUser,
    participants: params.participants ?? [params.responsibleUser],
    activeCopilots: DIRECT_DOMAIN_COPILOTS,
    flags,
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Uma etapa deve ser pulada quando é condicional e o Adaptive Engine a desativa. */
export function isStageSkipped(stage: DirectProcurementStage, flags: AdaptiveFlags): boolean {
  if (stage === "DFD") return !flags.usesDFD;
  if (stage === "PRICE_RESEARCH") return !flags.requiresPriceResearch;
  if (stage === "PROPOSAL_COLLECTION") return !flags.requiresProposalCollection;
  if (stage === "LEGAL_OPINION") return !flags.requiresLegalOpinion;
  return false;
}

/** Próxima etapa obrigatória, pulando as condicionais desativadas. */
export function nextDirectStage(ws: DirectProcurementWorkspace): DirectProcurementStage {
  const idx = DIRECT_STAGE_ORDER.indexOf(ws.currentStage);
  for (let i = idx + 1; i < DIRECT_STAGE_ORDER.length; i++) {
    const candidate = DIRECT_STAGE_ORDER[i];
    if (!isStageSkipped(candidate, ws.flags)) return candidate;
  }
  return ws.currentStage;
}

/**
 * R9 / SEM-064 — o ponteiro de ETAPA nunca afirma um ATO. Antes, estar na etapa RATIFICATION/PUBLICATION virava
 * status `ratificado`/`publicado` mesmo sem ato registrado. Agora o ponteiro só produz "em andamento" para essas
 * etapas; `ratificado` é gravado explicitamente pelo registro da decisão no ledger (PR-07) e `publicado` pela
 * publicação efetivamente gerada — e a leitura (`deriveDirectProcurementStatus`) revalida contra os atos registrados.
 */
function statusForStage(stage: DirectProcurementStage): DirectProcurementStatus {
  switch (stage) {
    case "LEGAL_OPINION": return "aguardando_parecer";
    case "CONTRACT": return "concluido";
    case "ARCHIVED": return "arquivado";
    case "NEW": return "rascunho";
    default: return "em_andamento";
  }
}

// ─── Status derivado dos ATOS REGISTRADOS (SEM-064) ────────────────────────────

/** Atos registrados que sustentam (ou não) o status exibido. */
export interface DirectRecordedActs {
  /** Decisão CORRENTE do ledger institucional (`institutional_decisions`), ou null quando não há ato. */
  readonly ratification: { readonly outcome: string; readonly revision: number; readonly decidedAt: string } | null;
  /** Nº de publicações gravadas (`generated_publications`) para o processo. */
  readonly publicationCount: number;
}

/** Status que AFIRMAM um ato registrado (só o ledger/as publicações os sustentam). */
const ACT_BACKED_STATUSES: ReadonlySet<DirectProcurementStatus> = new Set<DirectProcurementStatus>(["ratificado", "publicado"]);

export type RatificationBasis = "RECORDED_RATIFIED" | "RECORDED_NOT_RATIFIED" | "NO_RECORDED_ACT";
export type PublicationBasis = "RECORDED" | "NO_RECORDED_ACT";

export interface DerivedDirectStatus {
  readonly status: DirectProcurementStatus;
  readonly ratification: RatificationBasis;
  readonly publication: PublicationBasis;
  /** Afirmações do ponteiro gravado que os atos registrados NÃO sustentam (ex.: "ratificado" sem decisão). */
  readonly unsupportedPointerClaims: ReadonlyArray<"ratificado" | "publicado">;
}

/**
 * Status exibido = o que os ATOS REGISTRADOS sustentam. `ratificado` só com decisão corrente `ratificado` no ledger;
 * `publicado` só com ratificação corrente + publicações gravadas. Sem ato, o status NÃO afirma ratificação/publicação
 * (cai para "em andamento") e a base diz "NO_RECORDED_ACT". Vocabulário inalterado (HD-09): "não ratificado" não é um
 * status novo — aparece em `ratification = RECORDED_NOT_RATIFIED`. Os demais status (`rascunho`,
 * `em_andamento`, `aguardando_parecer`, `concluido`, `arquivado`) seguem o valor gravado: não há ato registrado
 * correspondente neste módulo (concluído/arquivado ficam como achado em aberto).
 */
export function deriveDirectProcurementStatus(
  stored: { readonly status: DirectProcurementStatus; readonly currentStage: DirectProcurementStage },
  acts: DirectRecordedActs,
): DerivedDirectStatus {
  const ratification: RatificationBasis = !acts.ratification ? "NO_RECORDED_ACT"
    : acts.ratification.outcome === "ratificado" ? "RECORDED_RATIFIED" : "RECORDED_NOT_RATIFIED";
  const published = ratification === "RECORDED_RATIFIED" && acts.publicationCount > 0;
  const publication: PublicationBasis = acts.publicationCount > 0 ? "RECORDED" : "NO_RECORDED_ACT";

  // NEW-028: o valor gravado NUNCA autoriza nada — os status "de ato" só saem dos atos registrados; do valor gravado
  // só se aproveita o que NÃO é afirmação de ato (e, no máximo, ele é REBAIXADO quando o ato não o sustenta).
  let status: DirectProcurementStatus;
  if (published) status = "publicado";
  else if (ratification === "RECORDED_RATIFIED") status = "ratificado";
  else status = ACT_BACKED_STATUSES.has(stored.status) ? "em_andamento" : stored.status;
  const sustained: Record<"ratificado" | "publicado", boolean> = { ratificado: ratification === "RECORDED_RATIFIED", publicado: published };
  const unsupported = (["ratificado", "publicado"] as const).filter((claim) => ACT_BACKED_STATUSES.has(stored.status) && stored.status === claim && !sustained[claim]);
  return { status, ratification, publication, unsupportedPointerClaims: unsupported };
}

/** Avança para a próxima etapa obrigatória (Adaptive Process Engine). */
export function advanceDirectStage(ws: DirectProcurementWorkspace, at?: string): DirectProcurementWorkspace {
  const next = nextDirectStage(ws);
  return { ...ws, currentStage: next, status: statusForStage(next), updatedAt: at ?? new Date().toISOString() };
}

/** Define explicitamente uma etapa (permite editar/retomar — nunca bloqueia). */
export function setDirectStage(ws: DirectProcurementWorkspace, stage: DirectProcurementStage, at?: string): DirectProcurementWorkspace {
  return { ...ws, currentStage: stage, status: statusForStage(stage), updatedAt: at ?? new Date().toISOString() };
}

/**
 * R9 / SEM-064 — marca a publicação: etapa PUBLICATION + status `publicado`. Chamar SÓ depois de as publicações terem
 * sido efetivamente gravadas (o status afirma um ato registrado); a leitura revalida (`deriveDirectProcurementStatus`).
 */
export function markDirectPublished(ws: DirectProcurementWorkspace, at?: string): DirectProcurementWorkspace {
  return { ...ws, currentStage: "PUBLICATION", status: "publicado", updatedAt: at ?? new Date().toISOString() };
}

export function setProcedureType(ws: DirectProcurementWorkspace, procedureType: DirectProcedureType, at?: string): DirectProcurementWorkspace {
  return { ...ws, procedureType, updatedAt: at ?? new Date().toISOString() };
}

export function setLegalBasis(ws: DirectProcurementWorkspace, legalBasis: string, at?: string): DirectProcurementWorkspace {
  return { ...ws, legalBasis, updatedAt: at ?? new Date().toISOString() };
}

export function configureFlags(ws: DirectProcurementWorkspace, flags: Partial<AdaptiveFlags>, at?: string): DirectProcurementWorkspace {
  return { ...ws, flags: { ...ws.flags, ...flags }, updatedAt: at ?? new Date().toISOString() };
}

const FLAG_LABELS: Record<keyof AdaptiveFlags, string> = {
  usesDFD: "Usa DFD",
  requiresPriceResearch: "Exige pesquisa de preços",
  requiresProposalCollection: "Exige recebimento de propostas",
  requiresLegalOpinion: "Exige parecer jurídico",
};

const yesNo = (v: boolean): string => (v ? "sim" : "não");

/**
 * R9 / SEM-064 — descreve a MUDANÇA de flags (antes → depois) para a timeline. `null` = nada mudou (no-op: nenhum
 * evento). Desligar `requiresLegalOpinion` é o caso sensível (o fluxo deixa de exigir o parecer): vira evento de
 * DECISÃO e o resumo o destaca. Só valores booleanos de configuração — sem dados pessoais.
 */
export function describeFlagChange(before: AdaptiveFlags, after: AdaptiveFlags): { summary: string; eventType: "decision" | "change" } | null {
  const changed = (Object.keys(FLAG_LABELS) as Array<keyof AdaptiveFlags>).filter((k) => before[k] !== after[k]);
  if (changed.length === 0) return null;
  const parts = changed.map((k) => `${FLAG_LABELS[k]}: ${yesNo(before[k])} → ${yesNo(after[k])}`);
  const legalOff = before.requiresLegalOpinion && !after.requiresLegalOpinion;
  return {
    eventType: legalOff ? "decision" : "change",
    summary: `Fluxo reconfigurado (${parts.join("; ")}).${legalOff ? " ATENÇÃO: o parecer jurídico deixou de ser exigido neste processo." : ""}`,
  };
}

export function usesDFD(ws: DirectProcurementWorkspace): boolean {
  return ws.flags.usesDFD;
}
