/**
 * Política PURA de apresentação de erros da criação de Contrato (F7b). Extraída para ser
 * determinística e testável — sem React/tRPC.
 *
 * Erros de validação (BAD_REQUEST/Zod) chegam com um corpo técnico (JSON de issues) que
 * NUNCA deve aparecer ao usuário. Aqui são mapeados para uma frase institucional em pt-BR.
 * O detalhe técnico deve ser preservado apenas em observabilidade (logs) pelo chamador.
 * Demais erros já vêm com mensagem tratada do backend e são exibidos como estão.
 */

export interface ContractErrorLike {
  readonly message: string;
  readonly data?: { readonly code?: string } | null;
}

const INSTITUTIONAL_VALIDATION_MSG =
  "Não foi possível criar o contrato: verifique os campos obrigatórios (origem, número e dados do contrato).";

/** true se o erro parece um corpo técnico de validação (Zod/JSON) que não deve vazar ao usuário. */
export function isRawValidationLeak(err: ContractErrorLike | null | undefined): boolean {
  if (!err) return false;
  if (err.data?.code === "BAD_REQUEST") return true;
  return /"code"\s*:\s*"|\[\s*\{|too_small|invalid_type|Required/i.test(err.message);
}

/** Mensagem institucional (pt-BR) a exibir; null quando não há erro. */
export function friendlyContractError(err: ContractErrorLike | null | undefined): string | null {
  if (!err) return null;
  return isRawValidationLeak(err) ? INSTITUTIONAL_VALIDATION_MSG : err.message;
}
