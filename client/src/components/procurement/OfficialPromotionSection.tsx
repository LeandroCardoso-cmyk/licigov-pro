import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import OfficialDocumentPanel from "../documents/OfficialDocumentPanel";
import { confirmationInvalidated, pinReviewSnapshot, type ReviewSnapshotIdentity } from "./reviewSnapshotPin";

/**
 * C.4B.1/C.4B.2 — OfficialPromotionSection (ETP/TR/Edital).
 *
 * Superfície de AUTORIDADE OFICIAL do /processos: emite (promove) o RASCUNHO PERSISTIDO EXATO como
 * versão IMUTÁVEL `emitido` em official_documents (decisão humana governada no backend) e exibe as
 * versões oficiais + timeline + export OFICIAL (somente `emitido`) via o OfficialDocumentPanel comum.
 *
 * C.4B.2 — REVIEW PRÉ-EMISSÃO: o aprovador vê o CONTEÚDO EXATO que autoriza. O `reviewSnapshot` (conteúdo
 * + hash) vem da query canônica reload-safe `reviewableDraft` (fonte única, carregada pela workspace) —
 * a emissão usa exatamente o hash do conteúdo exibido. O backend reconsulta o rascunho e compara hashes:
 * se mudou desde a revisão → CONFLICT (fail-closed), a UI recarrega o conteúdo e exige nova revisão.
 * A garantia de governança (papel, revisor ≠ autor, integridade, replay) é do BACKEND.
 */

export type ReviewSnapshot = {
  id: string;
  kind: string;
  title: string;
  content: string;
  status: string;
  contentHash: string;
  updatedAt: string;
};

export type OfficialPromotionSectionProps = {
  processId?: string;
  kind: "etp" | "tr" | "edital";
  /** C.4B.2 — conteúdo+hash EXATOS do rascunho persistido (query reviewableDraft), carregado na workspace. */
  reviewSnapshot: ReviewSnapshot | null;
};

const KIND_LABEL: Record<string, string> = { etp: "ETP", tr: "TR", edital: "Edital" };

export default function OfficialPromotionSection({ processId = "", kind, reviewSnapshot }: OfficialPromotionSectionProps) {
  const utils = trpc.useUtils();
  const enabled = processId.trim().length > 0;
  const { key: emitKey, rotate: rotateEmitKey } = useIdempotencyKey();
  // Identidade PINADA do snapshot no momento da confirmação (null = não confirmando). O contrato exige
  // que o hash emitido seja o hash REVISADO/CONFIRMADO — nunca o do estado mutável no clique final.
  const [confirmPin, setConfirmPin] = useState<ReviewSnapshotIdentity | null>(null);
  const [staleNotice, setStaleNotice] = useState(false);
  // Rascunho mudou ENQUANTO confirmando → confirmação cancelada; exige nova revisão antes de emitir.
  const [pinInvalidated, setPinInvalidated] = useState(false);

  const summary = trpc.procurementProcess.officialSummary.useQuery({ processId, kind }, { enabled });

  const invalidateReview = () => {
    if (!processId) return;
    utils.procurementProcess.reviewableDraft.invalidate({ processId, kind });
    utils.procurementProcess.officialSummary.invalidate({ processId, kind });
  };

  const promote = trpc.procurementProcess.promoteOfficial.useMutation({
    onSuccess: () => {
      rotateEmitKey();
      setConfirmPin(null);
      setStaleNotice(false);
      setPinInvalidated(false);
      if (processId) {
        invalidateReview();
        utils.documentEngine.list.invalidate({ businessDomain: "processo_licitatorio", origin: processId });
      }
    },
    onError: (e) => {
      setConfirmPin(null);
      // Fail-closed: se o rascunho mudou desde a revisão (CONFLICT), NÃO auto-emite — recarrega o
      // conteúdo/hash vigente e exige nova revisão/confirmação.
      if (e.data?.code === "CONFLICT") {
        setStaleNotice(true);
        invalidateReview();
      }
    },
  });

  // PIN: se o rascunho MUDAR enquanto a confirmação está pinada (hash vigente ≠ hash confirmado, ou o
  // snapshot sumiu), cancela automaticamente a confirmação e exige nova revisão — nunca auto-confirma a
  // nova versão. O clique final ("Confirmar") também usa o hash PINADO, não o mutável.
  useEffect(() => {
    if (confirmPin && confirmationInvalidated(confirmPin, reviewSnapshot ?? null)) {
      setConfirmPin(null);
      setPinInvalidated(true);
    }
  }, [confirmPin, reviewSnapshot]);

  if (!enabled) return null;

  const s = summary.data;
  const latest = s?.latestOfficial ?? null;
  const diverged = s?.diverged ?? false;
  const neverEmitted = s?.neverEmitted ?? false;

  // A emissão SÓ é possível com um review snapshot carregado (conteúdo visível + hash) — nunca apenas
  // pelo hash do officialSummary sem o conteúdo correspondente à vista do humano.
  const hasReview = !!reviewSnapshot && reviewSnapshot.content.trim().length > 0 && reviewSnapshot.contentHash.length > 0;
  const confirming = confirmPin !== null;
  const canEmit = hasReview && !promote.isPending;

  // "Emitir documento oficial": entra em confirmação PINANDO a identidade do snapshot revisado agora.
  const startConfirm = () => {
    const pin = pinReviewSnapshot(reviewSnapshot);
    if (!pin) return;
    setStaleNotice(false);
    setPinInvalidated(false);
    setConfirmPin(pin);
  };

  const cancelConfirm = () => setConfirmPin(null);

  const doEmit = () => {
    if (!processId || !confirmPin) return;
    // Se o rascunho mudou entre "Emitir" e "Confirmar", NÃO emite — invalida a confirmação pinada e
    // exige nova revisão (defesa no clique, além do efeito reativo).
    if (confirmationInvalidated(confirmPin, reviewSnapshot ?? null)) {
      setConfirmPin(null);
      setPinInvalidated(true);
      return;
    }
    setStaleNotice(false);
    promote.mutate({
      processId,
      kind,
      idempotencyKey: emitKey,
      // Vincula a emissão AO HASH PINADO na confirmação (conteúdo revisado) — nunca o estado mutável.
      expectedContentHash: confirmPin.contentHash,
    });
  };

  return (
    <div className="mt-6 space-y-3">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-foreground">Documento oficial ({KIND_LABEL[kind]})</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Emitir cria uma <strong>versão oficial imutável</strong> a partir do conteúdo revisado abaixo.
              Regenerar o rascunho depois <strong>não</strong> altera a versão emitida — uma nova emissão cria
              uma nova versão.
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
        {staleNotice && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            O rascunho <strong>mudou desde a revisão</strong>. O conteúdo abaixo foi recarregado — revise
            novamente e confirme para emitir a versão vigente.
          </div>
        )}
        {pinInvalidated && (
          <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            O rascunho mudou desde a revisão. Revise novamente antes de emitir.
          </div>
        )}

        {/* C.4B.2 — REVIEW PRÉ-EMISSÃO: o conteúdo EXATO que será emitido, à vista do aprovador. */}
        {hasReview ? (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Conteúdo a emitir — {reviewSnapshot!.title}</span>
              <span className="text-[11px] text-muted-foreground">atualizado em {reviewSnapshot!.updatedAt}</span>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 font-sans text-xs text-foreground">
              {reviewSnapshot!.content}
            </pre>
          </div>
        ) : (
          <p className="mt-4 text-xs text-amber-600 dark:text-amber-400">
            Gere/carregue o rascunho para revisar o conteúdo antes de emitir.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3">
          {!confirming ? (
            <button
              type="button"
              onClick={startConfirm}
              disabled={!canEmit}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              Emitir documento oficial
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground">Confirmar emissão oficial do conteúdo revisado acima?</span>
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
                onClick={cancelConfirm}
                disabled={promote.isPending}
                className="rounded-lg border border-input px-3 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
        {promote.isError && promote.error.data?.code !== "CONFLICT" && (
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
