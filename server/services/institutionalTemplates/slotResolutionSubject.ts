/**
 * E2 — assunto do ledger da resolução humana de slot: `<manifestId M1>:<sha256("slot:"+slotKey)[0..16]>` (lock do M1, mesmo padrão do
 * aceite de narrativa). Módulo folha: usado pelo serviço de resolução e pelo adapter de leitura sem ciclo de import.
 */
import { createHash } from "crypto";
import type { DecisionSubjectType } from "../../domain/institutionalDecision";

export const SLOT_RESOLUTION_SUBJECT = "institutional_template.slot_resolution" as const satisfies DecisionSubjectType;

export const slotResolutionSubjectId = (manifestId: string, slotKey: string): string =>
  `${manifestId}:${createHash("sha256").update(`slot:${slotKey}`).digest("hex").slice(0, 16)}`;
