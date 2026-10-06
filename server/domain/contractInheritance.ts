/**
 * R9 / SEM-062 — HERANÇA do contrato a partir da origem (Contratação Direta / Processo Licitatório): valor e contratado.
 *
 * Princípios (CLAUDE.md: IA supervisionada / nada silencioso / nada inventado):
 *  - só se propõe o que tem EVIDÊNCIA CANÔNICA: na Contratação Direta, a decisão de ratificação VIGENTE no ledger
 *    (`institutional_decisions`, outcome "ratificado") + as propostas REGISTRADAS do workspace (`proposal_collections`);
 *  - o ledger NÃO nomeia a proposta vencedora (não há "proposta selecionada" canônica), então o sistema NÃO escolhe:
 *    devolve as propostas candidatas, com a procedência de cada uma (id do registro), e o HUMANO seleciona e confirma
 *    no assistente. O servidor re-deriva contratado/valor do registro da proposta (nunca confia em número do cliente
 *    para o que diz ser proveniente da proposta) e registra a procedência na timeline do contrato;
 *  - o Processo Licitatório canônico NÃO tem registro de adjudicação/homologação/proposta vencedora (status:
 *    rascunho/em_andamento/em_revisao/emitido; itens só têm valor ESTIMADO) ⇒ `no_canonical_evidence`: o assistente
 *    deixa contratado/valor em branco — nada é pré-preenchido por inferência;
 *  - o contrato continua nascendo MINUTA, editável e revisável; a proposta é sugestão até a confirmação humana.
 * Puro e determinístico (sem DB). Valores em REAIS (DECIMAL(15,2), mesma unidade de `contract_workspaces.value`).
 */
import type { InstitutionalDecision } from "./institutionalDecision";

export type ContractInheritanceSource = "contratacao_direta" | "processo_licitatorio";

/** Motivos estáveis (não traduzir) da ausência de evidência canônica. */
export const INHERITANCE_NO_EVIDENCE_REASONS = {
  PROCUREMENT_NO_AWARD_RECORD: "PROCUREMENT_NO_AWARD_RECORD",
  DIRECT_NOT_RATIFIED: "DIRECT_NOT_RATIFIED",
  DIRECT_NO_PROPOSALS: "DIRECT_NO_PROPOSALS",
} as const;
export type InheritanceNoEvidenceReason = keyof typeof INHERITANCE_NO_EVIDENCE_REASONS;

/** Mensagens pt-BR exibidas ao humano (sem jargão técnico). */
export const INHERITANCE_NO_EVIDENCE_MESSAGES: Record<InheritanceNoEvidenceReason, string> = {
  PROCUREMENT_NO_AWARD_RECORD:
    "O processo licitatório não possui registro de adjudicação/homologação no sistema; contratado e valor devem ser informados manualmente.",
  DIRECT_NOT_RATIFIED:
    "A contratação direta não tem decisão de ratificação vigente (ratificado) registrada; contratado e valor devem ser informados manualmente.",
  DIRECT_NO_PROPOSALS:
    "A contratação direta está ratificada, mas não há proposta registrada; contratado e valor devem ser informados manualmente.",
};

export const INHERITANCE_PROPOSAL_NOTICE =
  "Sugestão a partir de registros do sistema — confira e confirme. O sistema não escolhe a proposta vencedora: selecione a que corresponde ao contratado.";

/** Proposta registrada na contratação direta (candidata à herança). */
export interface InheritanceCandidate {
  readonly proposalId: string;
  readonly supplierName: string;
  readonly supplierDocument: string;
  /** Reais. */
  readonly value: number;
  readonly protocol: string;
  readonly receivedVia: string;
}

export interface InheritanceDecisionRef {
  readonly decisionId: string;
  readonly revision: number;
  readonly outcome: string;
  readonly decidedAt: string;
  readonly decidedByRole: string;
}

export type ContractInheritanceProposal =
  | {
    readonly kind: "proposal";
    readonly sourceType: "contratacao_direta";
    readonly sourceId: string;
    readonly decision: InheritanceDecisionRef;
    readonly candidates: readonly InheritanceCandidate[];
    readonly notice: string;
  }
  | {
    readonly kind: "no_canonical_evidence";
    readonly sourceType: ContractInheritanceSource;
    readonly sourceId: string;
    readonly reason: InheritanceNoEvidenceReason;
    readonly message: string;
    readonly candidates: readonly [];
  };

const noEvidence = (sourceType: ContractInheritanceSource, sourceId: string, reason: InheritanceNoEvidenceReason): ContractInheritanceProposal => ({
  kind: "no_canonical_evidence", sourceType, sourceId, reason, message: INHERITANCE_NO_EVIDENCE_MESSAGES[reason], candidates: [],
});

/** Licitação: não existe registro canônico de adjudicação ⇒ nunca há proposta (nada é inferido). */
export function buildProcurementInheritanceProposal(processId: string): ContractInheritanceProposal {
  return noEvidence("processo_licitatorio", processId, "PROCUREMENT_NO_AWARD_RECORD");
}

/**
 * Contratação direta: só há proposta com decisão VIGENTE `ratificado` + propostas registradas. Decisão ausente ou
 * `nao_ratificado` (incl. superação) ⇒ sem evidência. Ordem das candidatas = a do registro (nenhuma é "preferida").
 */
export function buildDirectInheritanceProposal(params: {
  directWorkspaceId: string;
  currentDecision: Pick<InstitutionalDecision, "id" | "revision" | "outcome" | "decidedAt" | "decidedByRole"> | null;
  proposals: ReadonlyArray<{ id: string; supplierName: string; supplierDocument: string; proposalValue: number; protocol: string; receivedVia: string }>;
}): ContractInheritanceProposal {
  const d = params.currentDecision;
  if (!d || d.outcome !== "ratificado") return noEvidence("contratacao_direta", params.directWorkspaceId, "DIRECT_NOT_RATIFIED");
  if (params.proposals.length === 0) return noEvidence("contratacao_direta", params.directWorkspaceId, "DIRECT_NO_PROPOSALS");
  return {
    kind: "proposal", sourceType: "contratacao_direta", sourceId: params.directWorkspaceId,
    decision: { decisionId: d.id, revision: d.revision, outcome: d.outcome, decidedAt: d.decidedAt, decidedByRole: d.decidedByRole },
    candidates: params.proposals.map((p) => ({
      proposalId: p.id, supplierName: p.supplierName, supplierDocument: p.supplierDocument, value: p.proposalValue,
      protocol: p.protocol, receivedVia: p.receivedVia,
    })),
    notice: INHERITANCE_PROPOSAL_NOTICE,
  };
}

const cents = (v: number): number => Math.round(Number(v) * 100);

/**
 * Confirmação humana: o contratado/valor efetivamente gravados divergem do que a proposta traz? (Só para a trilha
 * de auditoria — divergência é permitida: o humano pode corrigir antes de confirmar; ela apenas fica registrada.)
 */
export function inheritanceDiverges(candidate: Pick<InheritanceCandidate, "supplierName" | "value">, confirmed: { contractor: string; value: number }): boolean {
  return candidate.supplierName.trim() !== confirmed.contractor.trim() || cents(candidate.value) !== cents(confirmed.value);
}
