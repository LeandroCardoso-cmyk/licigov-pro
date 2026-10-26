/**
 * NOVO CICLO DE VERSÃO OFICIAL — FUNDAÇÃO de domínio (regra pura, sem estado, sem rota).
 *
 * Problema: um documento já EMITIDO (ex.: TR v2) não pode ser regenerado (OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE);
 * quando as fontes mudam depois da emissão, a nova emissão também fica bloqueada (EMISSION_SOURCES_CHANGED), pois só a
 * regeneração renova os marcadores de fonte. Falta um CICLO GOVERNADO que, aberto por quem tem autoridade, libere a
 * elaboração de uma nova versão — sem tocar na versão emitida — e que se feche sozinho quando a nova versão for emitida.
 *
 * Este módulo contém só o que NÃO depende de política institucional:
 *   - numeração (derivada do ledger/linhagem — nunca presumida);
 *   - invariantes de um ciclo aberto (base = versão emitida vigente; fecha-se por emissão posterior);
 *   - o contrato da política (`NewVersionPolicy`) SEM valores padrão: quem pode abrir, se o motivo é obrigatório, como
 *     exibir a versão anterior e o efeito sobre o Edital são DECISÕES DO OWNER. Nenhuma instância é fornecida aqui;
 *     o comando de abertura (futuro) exigirá a política aprovada como argumento obrigatório.
 *
 * Nada aqui é chamado por rota ou tela: o comportamento atual do sistema não muda.
 */
import type { OrgRole } from "../../drizzle/schema";

// ─── Numeração ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Linha do ledger de emissões (`official_document_promotions`). A versão é a de `official_documents.version` da linha
 * EMITIDA — a linhagem é compartilhada com os snapshots técnicos (`gerado`), por isso as emissões NÃO são ordinais
 * contíguos (a 1ª emissão de um TR gerado uma vez é a v2).
 */
export interface EmissionLedgerRow {
  readonly version: number;
  readonly officialDocumentId: string;
}

/** Última versão EMITIDA (null quando nunca houve emissão). */
export function latestOfficialVersion(ledger: readonly EmissionLedgerRow[]): number | null {
  let max: number | null = null;
  for (const r of ledger) if (Number.isInteger(r.version) && r.version > 0 && (max === null || r.version > max)) max = r.version;
  return max;
}

/** Ordinal da emissão (1ª, 2ª, …) correspondente a uma versão emitida. Versão que não está no ledger ⇒ erro. */
export function emissionOrdinal(ledger: readonly EmissionLedgerRow[], version: number): number {
  if (!ledger.some((r) => r.version === version)) throw new Error(`Versão v${version} não consta do ledger de emissões.`);
  return 1 + ledger.filter((r) => r.version < version).length;
}

/**
 * Próxima versão da linhagem (a que uma nova emissão receberá): `MAX(version da linhagem) + 1` — inclui os snapshots
 * técnicos, exatamente como `createDocument` atribui. O ledger sozinho NÃO prevê o número quando há snapshot posterior à
 * última emissão; por isso a linhagem é obrigatória. Linhagem menor que a última emissão é inconsistência (erro).
 */
export function nextOfficialVersion(input: { readonly lineageMaxVersion: number; readonly ledger: readonly EmissionLedgerRow[] }): number {
  const latest = latestOfficialVersion(input.ledger) ?? 0;
  if (!Number.isInteger(input.lineageMaxVersion) || input.lineageMaxVersion < latest) {
    throw new Error(`Linhagem inconsistente: versão máxima ${input.lineageMaxVersion} < última emissão v${latest}.`);
  }
  return input.lineageMaxVersion + 1;
}

// ─── Ciclo de nova versão ───────────────────────────────────────────────────────────────────────────────────────────

/** Ciclo de nova versão aberto sobre uma versão EMITIDA (registro auditável; persistência definida na ativação). */
export interface OpenVersionCycle {
  readonly lineageId: string;
  readonly kind: "etp" | "tr" | "edital";
  readonly baseOfficialVersion: number;
  readonly baseOfficialDocumentId: string;
  readonly openedByUserId: number;
  readonly reason: string | null;
  readonly correlationId: string;
  readonly openedAt: string;
}

/** Versão emitida vigente, como o ledger a descreve. */
export interface LatestOfficial {
  readonly version: number;
  readonly officialDocumentId?: string | null;
  readonly lineageId?: string | null;
  readonly kind?: string | null;
}

export type CycleRefusal = "CYCLE_BASE_NOT_LATEST" | "CYCLE_CLOSED_BY_EMISSION" | "CYCLE_KIND_MISMATCH" | "CYCLE_DOCUMENT_MISMATCH" | "CYCLE_LINEAGE_MISMATCH";

/**
 * Recusa tipada de um ciclo frente à emissão vigente (null = ciclo válido). O ciclo vale só sobre a versão emitida
 * VIGENTE: uma emissão posterior (nova versão) fecha o ciclo implicitamente — sem comando de fechamento nem estado extra.
 */
export function cycleRefusal(cycle: OpenVersionCycle, latest: LatestOfficial | null | undefined): CycleRefusal | null {
  if (!latest) return "CYCLE_BASE_NOT_LATEST";
  if (latest.kind && latest.kind !== cycle.kind) return "CYCLE_KIND_MISMATCH";
  if (latest.lineageId && latest.lineageId !== cycle.lineageId) return "CYCLE_LINEAGE_MISMATCH";
  if (latest.version > cycle.baseOfficialVersion) return "CYCLE_CLOSED_BY_EMISSION";
  if (latest.version !== cycle.baseOfficialVersion) return "CYCLE_BASE_NOT_LATEST";
  if (latest.officialDocumentId && latest.officialDocumentId !== cycle.baseOfficialDocumentId) return "CYCLE_DOCUMENT_MISMATCH";
  return null;
}

/** O ciclo libera a elaboração de nova versão sobre `latest`? */
export function isCycleOpenFor(latest: LatestOfficial | null | undefined, cycle: OpenVersionCycle | null | undefined): boolean {
  return !!cycle && cycleRefusal(cycle, latest) === null;
}

// ─── Política (contrato SEM valores padrão — decisão do Owner) ─────────────────────────────────────────────────────

/**
 * Política institucional do novo ciclo. Propositalmente sem instância/padrão neste repositório: o comando de abertura só
 * poderá ser exposto depois que o Owner aprovar estes valores (quem abre, motivo, exibição da versão anterior, efeito
 * sobre o Edital vinculado). Não converter proposta em política.
 */
export interface NewVersionPolicy {
  /** Papel mínimo na organização para abrir o ciclo. */
  readonly whoMayOpen: OrgRole;
  readonly reasonRequired: boolean;
  readonly reasonMinChars?: number;
  /** Como a versão anterior aparece depois da nova emissão (só exibição; a versão anterior nunca muda). */
  readonly supersededDisplay: "keep_listed" | "mark_superseded";
  /** Efeito sobre um Edital que fixou o TR anterior (nunca há atualização automática de publicação). */
  readonly editalEffectOnTrNewVersion: "none" | "flag_stale" | "block_edital_emission";
}

/** Validação do motivo conforme a política (pura). */
export function reasonRefusal(policy: Pick<NewVersionPolicy, "reasonRequired" | "reasonMinChars">, reason: string | null | undefined): "REASON_REQUIRED" | "REASON_TOO_SHORT" | null {
  const r = (reason ?? "").trim();
  if (!policy.reasonRequired) return null;
  if (!r) return "REASON_REQUIRED";
  if (policy.reasonMinChars && r.length < policy.reasonMinChars) return "REASON_TOO_SHORT";
  return null;
}
