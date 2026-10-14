import type { PublicationPendingView } from "@/lib/editalReadiness";

export interface PublicationPendingNoticeProps {
  pending: PublicationPendingView;
  /** `drafting`: durante a elaboração (discreto). `finalizing`: ao finalizar/emitir (lista tudo que falta para PUBLICAR). */
  variant: "drafting" | "finalizing";
}

/**
 * Dados de publicação ainda não definidos. NUNCA bloqueia a elaboração nem a finalização no LiciGov Pro (que não publica oficialmente editais): apenas informa.
 * A minuta mantém, nesses pontos, o texto governado "A DEFINIR PARA PUBLICAÇÃO" (nenhum valor é inventado).
 */
export function PublicationPendingNotice({ pending, variant }: PublicationPendingNoticeProps) {
  if (!pending.applicable || pending.complete || pending.items.length === 0) return null;
  const list = pending.items.map((i) => i.label).join(" · ");
  if (variant === "drafting") {
    return (
      <p className="mb-3 text-xs text-muted-foreground" data-testid="publication-pending-drafting">
        Ainda não definidos ({pending.items.length}): {list}. Nesses pontos a minuta mostra “A DEFINIR PARA PUBLICAÇÃO”; informe-os quando o certame estiver pronto — não impede a elaboração.
      </p>
    );
  }
  return (
    <div role="status" className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300" data-testid="publication-pending-finalizing">
      <strong>Antes de publicar oficialmente este Edital, defina:</strong> {list}.
      <span className="mt-1 block text-xs">A minuta ainda contém “A DEFINIR PARA PUBLICAÇÃO” nesses pontos. O LiciGov Pro não publica editais oficialmente; esta lista não bloqueia a emissão deste documento.</span>
    </div>
  );
}
