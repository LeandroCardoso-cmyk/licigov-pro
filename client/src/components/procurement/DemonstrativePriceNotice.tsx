/**
 * Pós-M8 — aviso de VALORES DEMONSTRATIVOS na prévia do rascunho (ETP/TR/Edital). O texto vem pronto do servidor (fonte única,
 * a mesma do cabeçalho do arquivo exportado); aqui só é exibido. Ausente ⇒ nada.
 */
export default function DemonstrativePriceNotice({ notice }: { notice: string | null | undefined }) {
  if (!notice) return null;
  return (
    <div role="note" data-testid="demonstrative-price-notice"
      className="mb-3 rounded-lg border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-800 dark:text-orange-300">
      {notice}
    </div>
  );
}
