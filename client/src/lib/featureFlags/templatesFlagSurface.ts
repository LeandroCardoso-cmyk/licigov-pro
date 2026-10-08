/**
 * Superfície operacional (platform admin) da flag FF_INSTITUTIONAL_TEMPLATES_V1 — lógica pura, sem React/rede.
 * Toda LEITURA passa por `trpc.featureFlagAdmin.getTenantFlag` e toda ESCRITA por `trpc.featureFlagAdmin.setTenantFlag`
 * (mecanismo institucional existente). A flag NÃO é editável, o `organizationId` vem do tenant autenticado
 * (`institutionalTemplates.getCapabilities`) e a autoridade de escrita é `writeAllowed` do backend.
 */
import { canOperate, type TenantFlagViewLike } from "./shadowFlagSurface";

/** Único nome de flag operado por esta superfície (espelha o allowlist do backend; nunca vem de input). */
export const TEMPLATES_FLAG = "FF_INSTITUTIONAL_TEMPLATES_V1" as const;

/** Mínimo de caracteres da justificativa em produção (espelha o backend; o backend continua sendo a autoridade). */
export const TEMPLATES_REASON_MIN_LENGTH = 15;

export const TEMPLATES_ACTIVATION_NOTICE =
  "Habilita os Modelos Institucionais somente para esta organização. Não registra modelo, não publica, não cria vínculo e não toca processos.";
export const TEMPLATES_ENABLED_MESSAGE = "Modelos Institucionais habilitados para esta organização.";
export const TEMPLATES_DISABLED_MESSAGE = "Modelos Institucionais desativados para esta organização (histórico preservado).";
export const TEMPLATES_WRITE_BLOCKED_MESSAGE = "A escrita desta flag não está permitida neste ambiente.";

export function validateTemplatesFlagReason(reason: string): { valid: boolean; error?: string } {
  const r = reason.trim();
  if (!r) return { valid: false, error: "Justificativa obrigatória." };
  if (r.length < TEMPLATES_REASON_MIN_LENGTH) return { valid: false, error: `Justificativa com no mínimo ${TEMPLATES_REASON_MIN_LENGTH} caracteres.` };
  return { valid: true };
}

/** Quem pode VER o controle (defesa em profundidade; o backend `adminProcedure` é a autoridade real). */
export const canSeeTemplatesFlagControl = (role: string | null | undefined): boolean => role === "admin";

/** Pode mutar? Só com `writeAllowed` do backend (a UI não decide pelo ambiente). */
export const canMutateTemplatesFlag = (view: Pick<TenantFlagViewLike, "writeAllowed"> | null | undefined): boolean => canOperate(view);

/** Payload EXATO de `setTenantFlag`: flagName fixo, sem expiração, chave idempotente por operação. */
export function buildTemplatesFlagRequest(params: { organizationId: number; enabled: boolean; reason: string; idempotencyKey: string }) {
  return {
    organizationId: params.organizationId,
    flagName: TEMPLATES_FLAG,
    enabled: params.enabled,
    expiresAt: null,
    reason: params.reason.trim(),
    idempotencyKey: params.idempotencyKey,
  };
}
