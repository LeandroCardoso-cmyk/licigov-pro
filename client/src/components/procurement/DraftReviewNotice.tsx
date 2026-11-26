/**
 * LICIGOV-LAUNCH-READY PRD-02 — aviso único do rascunho editável (ETP / TR / Edital).
 *
 * Fonte de verdade: `server/services/documentPromotionService.ts` (#351). A emissão interna NÃO exige um terceiro
 * servidor: quem elaborou/revisou e tem competência operacional (papel mínimo `manager` com vínculo real no órgão)
 * emite a sua versão; autoria, última edição e emissor ficam registrados. Os banners antigos diziam "a emissão oficial
 * exige revisão de um terceiro (SoD)", contradizendo o backend e a própria seção de emissão. Segregação autor ≠
 * aprovador continua valendo onde existe de fato (parecer, aprovação/ratificação, publicação) — fora desta tela.
 */
export const DRAFT_REVIEW_NOTICE_TEXT =
  "Rascunho editável — revise o conteúdo e salve. A emissão interna é feita por servidor com papel de gestor no órgão e registra quem elaborou, quem editou por último e quem emitiu. Emitir não equivale a parecer jurídico, aprovação da autoridade competente, assinatura ou publicação.";

export function DraftReviewNotice({ origin }: { origin?: string }) {
  return (
    <div
      className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
      data-testid="draft-review-notice"
    >
      <strong>Revisão obrigatória.</strong> {origin ? `${origin} ` : ""}
      {DRAFT_REVIEW_NOTICE_TEXT}
    </div>
  );
}
