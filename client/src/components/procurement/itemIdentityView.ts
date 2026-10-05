/**
 * R9 / SEM-054 — resolução HUMANA de identidade ambígua ("Identidade a revisar") — lógica pura da tela.
 *
 * O servidor já expõe `procurementProcess.resolveItemIdentity` (vínculo append-only da chave lógica a um item
 * existente OU declaração de item NOVO + re-materialização), mas não havia tela: o item ficava "a revisar" sem saída.
 * Aqui ficam a extração da chave, as regras de habilitação e o corpo da chamada. Regras:
 *  - nada pré-selecionado (ação cega proibida — R11.4): o operador escolhe "vincular" OU "item novo";
 *  - o motivo (≥ 5 caracteres) é obrigatório e vai para a trilha;
 *  - cancelar não chama nada.
 */
export const IDENTITY_REASON_PREFIX = "identidade_ambigua:";
export const IDENTITY_REASON_MIN_LENGTH = 5;
export const IDENTITY_REASON_MAX_LENGTH = 255;

export type IdentityChoice = "link_existing" | "new_item";

/** Chave lógica (hash sha256, 64 hex) embutida no `sourceStateReason` da ambiguidade; null se não for essa classe. */
export function identityKeyHashFromReason(reason: string | null | undefined): string | null {
  if (typeof reason !== "string" || !reason.startsWith(IDENTITY_REASON_PREFIX)) return null;
  const hash = reason.slice(IDENTITY_REASON_PREFIX.length);
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

/** O botão "Resolver identidade" só existe para itens `review_required` com chave de identidade legível. */
export function canResolveIdentity(item: { sourceState?: string | null; sourceStateReason?: string | null }): boolean {
  return item.sourceState === "review_required" && identityKeyHashFromReason(item.sourceStateReason) !== null;
}

export interface IdentityResolutionDraft {
  readonly choice: IdentityChoice | null;
  readonly targetItemId: string | null;
  readonly reason: string;
}

export function identityResolutionBlocker(d: IdentityResolutionDraft): string | null {
  if (d.choice === null) return "Escolha como resolver: vincular a um item existente ou declarar item novo.";
  if (d.choice === "link_existing" && !d.targetItemId) return "Selecione o item existente ao qual esta identidade pertence.";
  if (d.reason.trim().length < IDENTITY_REASON_MIN_LENGTH) return `Informe o motivo da resolução (mín. ${IDENTITY_REASON_MIN_LENGTH} caracteres).`;
  return null;
}

/** Corpo de `resolveItemIdentity` — null quando a resolução ainda não pode ser enviada. */
export function resolveIdentityInput(
  processId: string,
  item: { sourceStateReason?: string | null },
  d: IdentityResolutionDraft,
): { processId: string; logicalKeyHash: string; targetItemId: string | null; reason: string } | null {
  const logicalKeyHash = identityKeyHashFromReason(item.sourceStateReason);
  if (!logicalKeyHash || identityResolutionBlocker(d) !== null || d.choice === null) return null;
  return {
    processId,
    logicalKeyHash,
    targetItemId: d.choice === "link_existing" ? d.targetItemId : null,
    reason: d.reason.trim().slice(0, IDENTITY_REASON_MAX_LENGTH),
  };
}

export const IDENTITY_EFFECT_NOTE =
  "Registra um vínculo permanente (append-only) entre a identidade desta cotação e o item escolhido — ou a declara como item novo — " +
  "e reprocessa as cotações já importadas. Não aprova nem rejeita nenhum item e não confirma catálogo; as decisões humanas existentes permanecem.";
