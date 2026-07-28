/**
 * PR B — Corte controlado do pipeline legado de Processo Licitatório.
 *
 * O pipeline legado (`processesRouter` + `documentsRouter` + páginas
 * Dashboard/NewProcess/ProcessDetails) deixou de ser a jornada operacional do
 * piloto. A criação e condução de processos ocorre EXCLUSIVAMENTE pelo fluxo
 * canônico (`procurementProcessRouter` + `components/procurement/*`).
 *
 * Este módulo centraliza a trava de gravação do pipeline legado. O ponto de
 * entrada que duplicava o canônico — a CRIAÇÃO de processo — passa a recusar
 * novas gravações. Como o responsável do projeto confirmou que NÃO há dados
 * legados a preservar, nenhum processo legado pode existir; por consequência,
 * as demais gravações legadas (itens, documentos, CATMAT) ficam naturalmente
 * inertes, pois não há processo legado-alvo para escrever.
 *
 * Código de erro estável (const-as-message parcial): o token
 * `LEGACY_PROCESS_PIPELINE_DISABLED` é estável para asserção em testes e
 * eventual tradução no cliente; a mensagem é pt-BR e orienta o usuário.
 */
import { TRPCError } from "@trpc/server";

/** Token estável do corte controlado (não traduzir; usado por testes/cliente). */
export const LEGACY_PROCESS_PIPELINE_DISABLED = "LEGACY_PROCESS_PIPELINE_DISABLED";

/**
 * Recusa uma gravação pelo pipeline legado de Processo Licitatório.
 * Erro FORBIDDEN com mensagem pt-BR + token estável.
 */
export function throwLegacyProcessPipelineDisabled(): never {
  throw new TRPCError({
    code: "FORBIDDEN",
    message:
      "O fluxo legado de Processo Licitatório foi desativado. Crie e conduza o " +
      "processo pela jornada canônica no módulo Processo Licitatório " +
      `(${LEGACY_PROCESS_PIPELINE_DISABLED}).`,
  });
}
