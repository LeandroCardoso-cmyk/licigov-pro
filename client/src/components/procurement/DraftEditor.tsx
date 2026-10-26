import { useEffect, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import { shouldRotateSaveKeyOnError } from "./saveKeyPolicy";
import DocumentMarkdownView from "../documents/DocumentMarkdownView";
import { hasInternalMarkers } from "@shared/documentMarkers";

/**
 * C.4B.3B — Edição HUMANA governada do rascunho canônico (ETP/TR/Edital).
 *
 * Superfície de edição mínima e controlada (textarea; sem rich editor). Carrega o conteúdo persistido
 * (reload-safe, via reviewableDraft) e envia a alteração governada com o `expectedContentHash` do
 * snapshot carregado — concorrência otimista revalidada no backend sob lock. NÃO emite/aprova: apenas
 * atualiza o working draft; a emissão governada (C.4B.1) e a SoD (C.4B.3A) seguem intactas.
 *
 * SUCCESS: rotaciona a key, invalida reviewableDraft+officialSummary, re-sincroniza com o snapshot.
 * CONFLICT: rotaciona a key, invalida/refetch, substitui o editor pelo conteúdo canônico recarregado.
 * Erro transitório/INTERNAL/network: MANTÉM a key e o conteúdo local (retry seguro/idempotente).
 */
export type DraftEditorProps = {
  processId: string;
  kind: "etp" | "tr" | "edital";
  /** Conteúdo + hash do snapshot persistido (reviewableDraft) — par inseparável. */
  content: string;
  contentHash: string;
  /** R9 / SEM-057 — avisa a workspace quando há edição NÃO salva (a emissão fica bloqueada até salvar). */
  onDirtyChange?: (dirty: boolean) => void;
};

export default function DraftEditor({ processId, kind, content, contentHash, onDirtyChange }: DraftEditorProps) {
  const utils = trpc.useUtils();
  const { key: saveKey, rotate: rotateSaveKey } = useIdempotencyKey();
  const [text, setText] = useState(content);
  const [conflict, setConflict] = useState(false);
  // M8 — visualização formatada (leitura) separada do texto técnico (edição); começa na visualização.
  const [mode, setMode] = useState<"view" | "edit">("view");
  // Sincroniza o editor com o snapshot persistido quando o HASH muda (recarga/refetch), sem sobrescrever
  // uma edição em curso sobre o mesmo snapshot.
  const loadedHash = useRef<string | null>(null);

  useEffect(() => {
    if (loadedHash.current !== contentHash) {
      setText(content);
      loadedHash.current = contentHash;
      setConflict(false);
    }
  }, [content, contentHash]);

  const invalidate = () => {
    utils.procurementProcess.reviewableDraft.invalidate({ processId, kind });
    utils.procurementProcess.officialSummary.invalidate({ processId, kind });
  };

  const save = trpc.procurementProcess.saveReviewableDraft.useMutation({
    onSuccess: () => { setConflict(false); rotateSaveKey(); invalidate(); },
    onError: (e) => {
      // Política única (saveKeyPolicy): rotaciona só em CONFLICT; erro transitório mantém a key.
      if (shouldRotateSaveKeyOnError(e.data?.code)) rotateSaveKey();
      if (e.data?.code === "CONFLICT") {
        setConflict(true);
        loadedHash.current = null; // força re-sincronizar o editor com o conteúdo canônico recarregado
        invalidate();
      }
    },
  });

  const dirty = text !== content;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  return (
    <div>
      {conflict && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          O rascunho mudou desde o carregamento. Revise novamente antes de salvar.
        </div>
      )}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">Conteúdo</span>
        <div role="tablist" aria-label="Modo do conteúdo" className="inline-flex rounded-lg border border-border p-0.5 text-xs">
          {([["view", "Visualizar"], ["edit", "Editar texto"]] as const).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === "view" ? (
        <div className="max-h-[36rem] overflow-auto rounded-lg border border-border bg-background p-4">
          <DocumentMarkdownView content={text} ariaLabel="Visualização do rascunho" />
        </div>
      ) : (
        <label className="flex flex-col text-sm">
          <span className="sr-only">Texto do rascunho (formato técnico)</span>
          {hasInternalMarkers(text) && (
            <span className="mb-1 text-xs text-muted-foreground">
              Trechos entre marcadores <code>licigov:</code> são gerados pelo sistema (quadro de itens) — não os altere.
            </span>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={18}
            className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => save.mutate({ processId, kind, content: text, expectedContentHash: contentHash, idempotencyKey: saveKey })}
          disabled={!text.trim() || !dirty || save.isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {save.isPending ? "Salvando..." : "Salvar alterações"}
        </button>
        {save.isSuccess && !conflict && !dirty && (
          <span className="text-sm text-green-600 dark:text-green-400">Alterações salvas.</span>
        )}
        {save.isError && save.error?.data?.code !== "CONFLICT" && (
          <span className="text-sm text-destructive">{save.error?.message || "Falha ao salvar as alterações."}</span>
        )}
      </div>
    </div>
  );
}
