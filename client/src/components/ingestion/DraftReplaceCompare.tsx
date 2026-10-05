import type { ReplaceSideSummary } from "@/lib/ingestion/documentImport";

/**
 * SEM-061 — comparação exibida ANTES de confirmar "Substituir rascunho": à esquerda o rascunho ATUAL (origem, última
 * alteração, tamanho e prévia do texto), à direita o documento importado que entra no lugar. A confirmação só habilita
 * com o conteúdo atual à vista; o hash exibido é o `expectedDraftContentHash` da substituição.
 */
function Side({ side, testId }: { side: ReplaceSideSummary; testId: string }) {
  return (
    <div data-testid={testId} className="min-w-0 space-y-1 rounded-md border border-border bg-card p-2 text-foreground">
      <h4 className="text-xs font-semibold">{side.title}</h4>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-2 gap-y-0.5 text-xs">
        {side.facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="break-words">{f.value}</dd>
          </div>
        ))}
      </dl>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-[11px] leading-snug">
        {side.preview && side.preview.trim() !== "" ? side.preview : "(sem prévia disponível)"}
        {side.truncated ? "\n[…]" : ""}
      </pre>
    </div>
  );
}

export default function DraftReplaceCompare({ current, incoming }: { current: ReplaceSideSummary; incoming: ReplaceSideSummary }) {
  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2" aria-label="Comparação entre o rascunho atual e o documento importado">
      <Side side={current} testId="replace-current" />
      <Side side={incoming} testId="replace-incoming" />
    </div>
  );
}
