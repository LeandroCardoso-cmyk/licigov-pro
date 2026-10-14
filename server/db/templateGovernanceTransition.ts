/**
 * Template Governance V2 — leitura do MARCO DE TRANSIÇÃO (registro imutável, semeado pela migration 0318 no instante efetivo do primeiro deploy).
 *
 * SOMENTE LEITURA: não existe caminho de UPDATE/DELETE/INSERT aqui (guarda estática em teste). Sem a linha, ilegível ou erro de leitura ⇒ `null` e o
 * chamador aplica o modo ESTRITO (evidência jurídica exigida) — nunca um valor presumido. O valor positivo é imutável e por isso cacheado no processo;
 * ausência/erro NUNCA é cacheado (a próxima leitura tenta de novo).
 */
import { eq } from "drizzle-orm";
import { templateGovernanceTransitionsTable } from "../../drizzle/schema";
import { serviceLogger } from "../services/observabilityService";
import { getDb } from "./connection";

export const LEGACY_POLICY_CUTOVER_KEY = "LEGACY_POLICY_CUTOVER";
export interface LegacyPolicyCutover { readonly cutoverAt: string; readonly recordedBy: string; readonly recordedAt: string }

const ISO_MS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const log = serviceLogger("templateGovernanceTransition");
let cached: LegacyPolicyCutover | null = null;

/** Só para testes: limpa o cache de processo. */
export function resetLegacyPolicyCutoverCache(): void { cached = null; }

export async function readLegacyPolicyCutover(): Promise<LegacyPolicyCutover | null> {
  if (cached) return cached;
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = await db.select().from(templateGovernanceTransitionsTable).where(eq(templateGovernanceTransitionsTable.markerKey, LEGACY_POLICY_CUTOVER_KEY)).limit(1);
    const r = rows[0];
    if (!r) return null;
    if (!ISO_MS_UTC.test(r.cutoverAtIso) || Number.isNaN(Date.parse(r.cutoverAtIso))) {
      log.warn("legacy_policy_cutover_unreadable", { markerKey: LEGACY_POLICY_CUTOVER_KEY });
      return null;
    }
    cached = { cutoverAt: r.cutoverAtIso, recordedBy: r.recordedBy, recordedAt: r.recordedAt };
    return cached;
  } catch (err) {
    log.warn("legacy_policy_cutover_read_failed", { message: err instanceof Error ? err.message : "falha desconhecida" });
    return null;
  }
}
