/**
 * Situação de VIGÊNCIA do contrato (fonte única, cliente e servidor). Aditado e apostilado são contratos EM VIGOR — as transições
 * do domínio voltam a `vigente` (server/domain/contractWorkspace.ts). Minuta ainda não vige; encerrado, rescindido e arquivado
 * não vigem mais. "Em andamento" (painel operacional) é outro conceito: tudo o que não foi concluído, inclusive minutas.
 */
export const CONTRACT_IN_FORCE_STATUSES = ["vigente", "aditado", "apostilado"] as const;

export function isContractInForce(status: string | null | undefined): boolean {
  return (CONTRACT_IN_FORCE_STATUSES as readonly string[]).includes(status ?? "");
}
