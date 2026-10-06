/**
 * Institutional Templates — ids determinísticos dos registros internos (eventos, referências).
 * Mesma entrada ⇒ mesmo id (a reexecução de uma transação por deadlock/replay converge, nunca duplica).
 */
import { createHash } from "crypto";

export function deterministicTemplateId(prefix: string, ...parts: ReadonlyArray<string | number>): string {
  const hex = createHash("sha256").update(`${prefix}:${parts.join(":")}`).digest("hex");
  return `${prefix}_${hex.slice(0, 24 - prefix.length - 1)}`;
}
