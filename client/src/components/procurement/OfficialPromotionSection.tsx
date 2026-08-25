import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import OfficialDocumentPanel from "../documents/OfficialDocumentPanel";

/**
 * C.4B.1 — OfficialPromotionSection (ETP/TR/Edital).
 *
 * Superfície de AUTORIDADE OFICIAL do /processos: emite (promove) o conteúdo ATUAL do rascunho como
 * versão IMUTÁVEL `emitido` em official_documents (decisão humana governada no backend) e exibe as
 * versões oficiais + timeline + export OFICIAL (somente `emitido`) via o OfficialDocumentPanel comum.
 * O rascunho (superfície operacional) permanece inalterado acima desta seção.
 *
 * A garantia de governança (papel, revisor ≠ autor, integridade, replay) é do BACKEND — a UI apenas
 * confirma a ação, sinaliza divergência (via hash existente) e não implementa lógica jurídica autônoma.
 */

export type OfficialPromotionSectionProps = {
  processId?: string;
  kind: "etp" | "tr" | "edital";
};

const KIND_LABEL: Record<string, string> = { etp: "ETP", tr: "TR", edital: "Edital" };

export default function OfficialPromotionSection({ processId = "", kind }: OfficialPromotionSectionProps) {
  const utils = trpc.useUtils();
  const enabled = processId.trim().length > 0;
  const { key: emitKey, rotate: rotateEmitKey } = useIdempotencyKey();
  const [confirming, setConfirming] = useState(false);

  const summary = trpc.procurementProcess.officialSummary.useQuery({ processId, kind }, { enabled });

  const promote = trpc.procurementProcess.promoteOfficial.useMutation({
    onSuccess: () => {
      rotateEmitKey();
      setConfirming(false);
      if (processId) {
        utils.procurementProcess.officialSummary.invalidate({ processId, kind });
        utils.documentEngine.list.invalidate({ businessDomain: "processo_licitatorio", origin: processId });
      }
    },
  });

  if (!enabled) return null;

  const s = summary.data;
  const draftExists = s?.draft.exists ?? false;
  const latest = s?.latestOfficial ?? null;
  const diverged = s?.diverged ?? false;
  const neverEmitted = s?.neverEmitted ?? false;

  const doEmit = () => {
    if (!processId) return;
    promote.mutate({
      processId,
      kind,
      idempotencyKey: emitKey,
      // Concorrência otimista: emite exatamente a versão que o operador revisou.
      expectedContentHash: s?.draft.contentHash ?? undefined,
    });
  };

  return (
    <div className="mt-6 space-y-3">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">Documento oficial ({KIND_LABEL[kind]})</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Emitir cria uma <strong>versão oficial imutável</strong> a partir do conteúdo atual do rascunho.
              O rascunho continua editável; editar depois <strong>não</strong> altera a versão emitida — uma nova
              emissão cria uma nova versão.
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            {latest ? `Emitida v${latest.version}` : "Nenhuma emitida"}
          </span>
        </div>

        {/* Divergência: rascunho difere da última versão emitida (pelo hash existente). */}
        {latest && diverged && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            O rascunho atual <strong>diverge</strong> da última versão oficial emitida (v{latest.version}). Emita
            novamente para oficializar o conteúdo vigente.
          </div>
        )}
        {latest && !diverged && (
          <div className="mt-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-700 dark:text-green-300">
            O rascunho atual corresponde à última versão oficial emitida (v{latest.version}).
          </div>
        )}
        {neverEmitted && (
          <div className="mt-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            Este {KIND_LABEL[kind]} ainda não tem versão oficial. O snapshot técnico gerado <strong>não</strong> é
            oficial — emita para produzir a versão institucional.
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={!draftExists || promote.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Emitir documento oficial
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground">Confirmar emissão oficial desta versão?</span>
              <button
                type="button"
                onClick={doEmit}
                disabled={promote.isPending}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {promote.isPending ? "Emitindo..." : "Confirmar"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={promote.isPending}
                className="rounded-lg border border-input px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          )}
          {!draftExists && (
            <span className="text-xs text-amber-600 dark:text-amber-400">Gere o rascunho antes de emitir.</span>
          )}
        </div>
        {promote.isError && (
          <p className="mt-2 text-sm text-destructive">{promote.error.message || "Falha ao emitir o documento oficial."}</p>
        )}
      </div>

      {/* Versões oficiais + timeline + EXPORT OFICIAL (somente 'emitido'). */}
      <OfficialDocumentPanel
        businessDomain="processo_licitatorio"
        origin={processId}
        title="Documentos oficiais (versões emitidas)"
        requireStatusForExport="emitido"
      />
    </div>
  );
}
