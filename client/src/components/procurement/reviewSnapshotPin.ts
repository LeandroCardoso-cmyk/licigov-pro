/**
 * C.4B.2 (hardening) — Pin do review snapshot na confirmação de emissão oficial.
 *
 * Puro — extraído do OfficialPromotionSection para ser testável sem jsdom/testing-library (padrão do
 * projeto — ver utils/inviteState.ts, darkmode-tokens.test.ts).
 *
 * Contrato: o conteúdo REVISADO/CONFIRMADO pelo humano = o hash enviado à emissão = o conteúdo emitido.
 * Ao entrar em confirmação, PINAMOS a identidade mínima do snapshot vigente. Se o rascunho mudar entre
 * "Emitir" e "Confirmar", a confirmação pinada é INVALIDADA — nada é emitido e uma nova revisão/
 * confirmação explícita passa a ser exigida (sem auto-confirmar a nova versão).
 */

/** Identidade mínima do review snapshot (NÃO copiamos o conteúdo inteiro — só o necessário ao contrato). */
export type ReviewSnapshotIdentity = {
  id: string;
  contentHash: string;
  updatedAt: string;
};

/** Snapshot vigente (subset lido da query reviewableDraft) suficiente para pinar/comparar. */
export type ReviewSnapshotLike = {
  id: string;
  contentHash: string;
  updatedAt: string;
};

/** Captura ("pina") a identidade do snapshot vigente ao entrar em confirmação. null se não há snapshot. */
export function pinReviewSnapshot(current: ReviewSnapshotLike | null | undefined): ReviewSnapshotIdentity | null {
  if (!current) return null;
  return { id: current.id, contentHash: current.contentHash, updatedAt: current.updatedAt };
}

/**
 * Decide se a confirmação PINADA foi invalidada pelo estado ATUAL do review snapshot.
 * Invalida quando: (a) o snapshot vigente sumiu, ou (b) seu contentHash difere do hash confirmado.
 * Retorna false quando não há confirmação pinada (não há nada para invalidar).
 */
export function confirmationInvalidated(
  pinned: ReviewSnapshotIdentity | null,
  current: { contentHash: string } | null | undefined,
): boolean {
  if (!pinned) return false;
  if (!current) return true;
  return current.contentHash !== pinned.contentHash;
}
