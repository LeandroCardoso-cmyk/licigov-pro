/**
 * Autoridade humana e RBAC dos Modelos Institucionais (Lane C).
 *
 * "manager" é um PISO TÉCNICO (mesma convenção do NEW-006): a competência jurídica de quem pode aprovar/publicar um modelo é
 * insumo pendente (`authorityValidation = NOT_VALIDATED_POLICY_PENDING` no ledger de decisões). IA/sistema nunca age.
 */
import type { OrgRole } from "../../../drizzle/schema";
import { TemplateWorkflowError } from "./errors";
import type { HumanActor } from "./ports";

export type TemplateAction =
  | "read" | "preview" | "draft" | "import" | "approve" | "publish" | "deprecate" | "bind" | "review" | "generate" | "govern";

/** Piso de papel por ação (aplicado no router por `orgRoleProcedure`; reafirmado nos testes). */
export const TEMPLATE_ACTION_MIN_ROLE: Readonly<Record<TemplateAction, OrgRole>> = Object.freeze({
  read: "viewer",
  preview: "viewer",
  draft: "operator",
  import: "operator",
  approve: "manager",
  publish: "manager",
  deprecate: "manager",
  bind: "manager",
  // revisão humana do documento composto (aceite de IA, reconhecimento de desvio) e geração por modelo: mesmo piso de edição
  review: "operator",
  generate: "operator",
  // atos institucionais do órgão sobre as fontes governadas (certame, política, orçamento) e evidência de aprovação jurídica
  govern: "manager",
});

/** Ações que exigem ator humano autenticado (todas as que mudam estado institucional). */
export function assertHumanActor(actor: unknown): asserts actor is HumanActor {
  const a = actor as { kind?: unknown; userId?: unknown } | null | undefined;
  if (!a || a.kind !== "human" || typeof a.userId !== "number" || !Number.isSafeInteger(a.userId) || a.userId <= 0) {
    throw new TemplateWorkflowError("HUMAN_ACTION_REQUIRED", "esta ação institucional só pode ser executada por uma pessoa autenticada (IA e sistema nunca aprovam, publicam, depreciam ou vinculam)");
  }
}
