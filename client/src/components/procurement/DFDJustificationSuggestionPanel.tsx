import { useState } from "react";
import {
  ACCEPT_BLOCK_MESSAGES, acceptBlock, acceptLabel, discardLabel, originNote, replacesExistingText,
  type JustificationSuggestionUI,
} from "./dfdJustificationSuggestion";

/**
 * SEM-058 — a sugestão de IA aparece AO LADO do texto atual (com a origem dele). Nada é gravado até o "Aceitar"
 * explícito; "Descartar" só fecha o painel (zero efeito no DFD). O texto sugerido pode ser editado antes do aceite.
 */
export type DFDJustificationSuggestionPanelProps = {
  suggestion: JustificationSuggestionUI;
  docContentHash: string | null | undefined;
  /** Há alterações não salvas no editor do DFD. */
  dirty: boolean;
  pending: boolean;
  errorMessage?: string | null;
  onAccept: (text: string) => void;
  onDiscard: () => void;
};

export default function DFDJustificationSuggestionPanel(props: DFDJustificationSuggestionPanelProps) {
  const [text, setText] = useState(props.suggestion.suggestion.text);
  return <DFDJustificationSuggestionView {...props} text={text} onTextChange={setText} />;
}

/** Visão sem estado (testável): o texto editável vem de fora; Aceitar envia o texto exibido; Descartar não envia nada. */
export function DFDJustificationSuggestionView({
  suggestion, docContentHash, dirty, pending, errorMessage, onAccept, onDiscard, text, onTextChange,
}: DFDJustificationSuggestionPanelProps & { text: string; onTextChange: (t: string) => void }) {
  const block = acceptBlock({ suggestion, docContentHash, text, dirty, pending });
  const replacing = replacesExistingText(suggestion);
  const unverified = suggestion.explanation.unverifiedNumbers;

  return (
    <section aria-label="Sugestão de IA para a justificativa" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Sugestão de justificativa (IA) — ainda não aceita</h2>
        <p className="text-xs text-muted-foreground">
          O DFD não foi alterado. Compare com o texto atual: o texto só muda se você aceitar. Revisão humana obrigatória.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <h3 className="text-xs font-medium text-foreground">Texto atual (seção 2)</h3>
          <p data-testid="current-origin" className="text-xs text-muted-foreground">
            Origem: <strong className="text-foreground">{suggestion.current.originLabel}</strong>. {originNote(suggestion.current.origin)}
          </p>
          <div data-testid="current-text" className="max-h-64 min-h-16 overflow-auto whitespace-pre-wrap break-words rounded-md border border-input bg-muted/50 px-3 py-2 text-xs text-foreground">
            {(suggestion.current.text ?? "").trim() === "" ? <span className="text-muted-foreground">Seção ainda não preenchida.</span> : suggestion.current.text}
          </div>
        </div>
        <label className="space-y-1 text-xs">
          <span className="block font-medium text-foreground">Sugestão da IA (você pode editar antes de aceitar)</span>
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            rows={9}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground focus:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>

      {unverified.length > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Trechos marcados com [REVISAR: …] não foram confirmados pelo processo: {unverified.join(", ")}.
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        Gerado por {suggestion.explanation.provider ?? "IA"}{suggestion.explanation.model ? ` (${suggestion.explanation.model})` : ""} · prompt {suggestion.explanation.promptVersion} · execução {suggestion.explanation.executionId.slice(0, 12)}
      </p>
      {replacing && block === null && (
        <p className="text-xs text-foreground">Ao aceitar, o texto atual acima será substituído; ele permanece no histórico de edições do DFD.</p>
      )}
      {block && block !== "pending" && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">{ACCEPT_BLOCK_MESSAGES[block]}</p>}
      {errorMessage && <p role="alert" className="text-xs text-destructive">{errorMessage}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onAccept(text)}
          disabled={block !== null}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {pending ? "Registrando..." : acceptLabel(suggestion)}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={pending}
          className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {discardLabel()}
        </button>
      </div>
    </section>
  );
}
