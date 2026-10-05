/**
 * R9 / SEM-062 — serviço de HERANÇA do contrato (proposta com procedência; confirmação humana).
 * Regras e limites de evidência: ver `server/domain/contractInheritance.ts`. Somente leitura, tenant-scoped, sem IA.
 */
import { TRPCError } from "@trpc/server";
import { getDirectProcurementWorkspace, listProposalCollections } from "../db/directProcurement";
import { getCurrentDecision } from "../db/institutionalDecisions";
import { getProcess } from "../db/procurement";
import {
  buildDirectInheritanceProposal, buildProcurementInheritanceProposal,
  type ContractInheritanceProposal, type ContractInheritanceSource, type InheritanceCandidate,
} from "../domain/contractInheritance";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("contractInheritanceService");

/** Token estável (não traduzir): proposta indicada não pertence a uma contratação direta ratificada desta organização. */
export const CONTRACT_INHERITANCE_PROPOSAL_NOT_FOUND = "CONTRACT_INHERITANCE_PROPOSAL_NOT_FOUND";
export const CONTRACT_INHERITANCE_NOT_RATIFIED = "CONTRACT_INHERITANCE_NOT_RATIFIED";

/** Proposta de herança da origem. Origem inexistente NO TENANT ⇒ NOT_FOUND (cross-tenant indistinguível do inexistente). */
export async function proposeContractInheritance(params: {
  organizationId: number; sourceType: ContractInheritanceSource; sourceId: string; correlationId: string;
}): Promise<ContractInheritanceProposal> {
  const notFound = new TRPCError({ code: "NOT_FOUND", message: "Origem do contrato não encontrada nesta organização." });
  let proposal: ContractInheritanceProposal;
  if (params.sourceType === "processo_licitatorio") {
    const process = await getProcess(params.sourceId, params.organizationId);
    if (!process) throw notFound;
    proposal = buildProcurementInheritanceProposal(params.sourceId);
  } else {
    const ws = await getDirectProcurementWorkspace(params.sourceId, params.organizationId);
    if (!ws) throw notFound;
    const [currentDecision, proposals] = await Promise.all([
      getCurrentDecision(null, params.organizationId, "direct_procurement.ratification", params.sourceId),
      listProposalCollections(params.sourceId, params.organizationId),
    ]);
    proposal = buildDirectInheritanceProposal({ directWorkspaceId: params.sourceId, currentDecision, proposals });
  }
  log.info("contract_inheritance_proposed", {
    organizationId: params.organizationId, sourceType: params.sourceType, sourceId: params.sourceId, kind: proposal.kind,
    reason: proposal.kind === "no_canonical_evidence" ? proposal.reason : null, candidates: proposal.candidates.length,
    correlationId: params.correlationId,
  });
  return proposal;
}

/**
 * Resolve a proposta que o HUMANO selecionou (id do registro) — usada na criação do contrato. Fail-closed, ANTES de
 * qualquer escrita: proposta inexistente / de outro workspace / de outro tenant ⇒ NOT_FOUND (mesma resposta);
 * contratação sem decisão vigente "ratificado" ⇒ PRECONDITION_FAILED. O servidor re-deriva contratado/valor do
 * REGISTRO da proposta (o que o cliente diz sobre a proposta não é confiado).
 */
export async function resolveSelectedDirectProposal(params: {
  organizationId: number; directWorkspaceId: string; proposalId: string; correlationId: string;
}): Promise<{ candidate: InheritanceCandidate; decisionId: string; decisionRevision: number }> {
  const proposal = await proposeContractInheritance({
    organizationId: params.organizationId, sourceType: "contratacao_direta", sourceId: params.directWorkspaceId, correlationId: params.correlationId,
  });
  if (proposal.kind !== "proposal") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${proposal.message} Nada foi gravado (${CONTRACT_INHERITANCE_NOT_RATIFIED}).`,
    });
  }
  const candidate = proposal.candidates.find((c) => c.proposalId === params.proposalId);
  if (!candidate) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Proposta não encontrada nesta contratação direta; nada foi gravado (${CONTRACT_INHERITANCE_PROPOSAL_NOT_FOUND}).` });
  }
  return { candidate, decisionId: proposal.decision.decisionId, decisionRevision: proposal.decision.revision };
}
