/**
 * Tipos de registro operacional com VIGÊNCIA (fonte única para servidor e tela).
 *
 * Informado o término da vigência de um contrato/aditivo/ata externo, o vencimento e os alertas
 * (90/60/30/15/7 dias) são gerados automaticamente pelo servidor. Nenhum outro tipo de registro
 * transforma datas em vencimento ou alerta.
 */
export type ExpirationKind = "contrato" | "aditivo" | "ata";

const EXPIRATION_KIND_BY_RECORD: Readonly<Record<string, ExpirationKind>> = {
  contrato_externo: "contrato",
  aditivo_externo: "aditivo",
  ata_externa: "ata",
};

export function expirationKindFor(recordType: string): ExpirationKind | null {
  return EXPIRATION_KIND_BY_RECORD[recordType] ?? null;
}
