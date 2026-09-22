import React, { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import { DocumentImportPanel } from "@/components/ingestion/DocumentImportPanel";
import OfficialPromotionSection from "./OfficialPromotionSection";
import DraftEditor from "./DraftEditor";
import GroundingNotice from "./GroundingNotice";
import AuthoringSourcesSummary from "./AuthoringSourcesSummary";

/**
 * TRWorkspace — REAL (wired to tRPC).
 *
 * P0 piloto — duas entradas para o MESMO rascunho canônico:
 *   - "Gerar TR com base no processo": autoria com o contexto REAL (DFD, ETP, Itens aprovados, cotações,
 *     classificação confirmada); quantidades/preços/totais entram por quadro gerado pelo sistema;
 *   - "Importar TR existente": a Secretaria já tem o TR — importado, revisado, aprovado e promovido a
 *     rascunho (o Edital reaproveita da mesma forma que um TR gerado).
 * Toda saída exige revisão humana; a emissão oficial exige revisão de terceiro (SoD).
 */

export type TRWorkspaceProps = {
  processId?: string;
  /** Abre a importação expandida (processo iniciado por "Importar TR existente"). */
  startWithImport?: boolean;
};

export default function TRWorkspace({ processId = "", startWithImport = false }: TRWorkspaceProps) {
  const [object, setObject] = useState("");
  const utils = trpc.useUtils();
  // Objeto pré-preenchido com o do processo (sem reentrada de dado já existente).
  const processQuery = trpc.procurementProcess.loadProcess.useQuery({ processId }, { enabled: !!processId });
  const processObject = processQuery.data?.process?.object ?? "";
  useEffect(() => { if (!object && processObject) setObject(processObject); }, [processObject]);

  const { key: trKey, rotate: rotateTrKey } = useIdempotencyKey();
  // C.4B.2 — leitura canônica RELOAD-SAFE do rascunho persistido (fonte única de verdade do conteúdo).
  const reviewable = trpc.procurementProcess.reviewableDraft.useQuery(
    { processId, kind: "tr" }, { enabled: !!processId },
  );
  const generateTR = trpc.procurementProcess.generateTR.useMutation({
    onSuccess: () => {
      rotateTrKey();
      if (processId) {
        utils.procurementProcess.reviewableDraft.invalidate({ processId, kind: "tr" });
        utils.procurementProcess.authoringSourceState.invalidate({ processId, kind: "tr" });
      }
    },
  });
  const draft = reviewable.data?.draft ?? null;

  const handleGenerate = () => {
    if (!processId || !object.trim()) return;
    generateTR.mutate({ processId, object: object.trim(), idempotencyKey: trKey });
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">
        TR — Termo de Referência
      </h1>
      <p className="text-sm text-muted-foreground">Art. 6º, XXIII da Lei 14.133/2021</p>

      <div className="mt-5 space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="font-medium text-foreground">Gerar TR com base no processo</h2>
        {processId && object.trim() && <AuthoringSourcesSummary processId={processId} kind="tr" object={object} />}
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-foreground">Objeto</span>
          <input
            type="text"
            value={object}
            onChange={(e) => setObject(e.target.value)}
            placeholder="Aquisição de mobiliário corporativo"
            className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!processId || !object.trim() || generateTR.isPending}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {generateTR.isPending ? "Gerando..." : "Gerar TR com base no processo"}
        </button>
        {!processId && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Selecione um processo para gerar o TR.
          </p>
        )}
        {generateTR.isError && (
          <p className="mt-2 text-sm text-destructive">{generateTR.error?.message || "Falha ao gerar o TR."}</p>
        )}
      </div>

      {processId && (
        <div className="mt-5">
          <DocumentImportPanel
            kind="tr" processId={processId} defaultOpen={startWithImport}
            onPromoted={() => utils.procurementProcess.authoringSourceState.invalidate({ processId, kind: "tr" })}
          />
        </div>
      )}

      {draft && (
        <div className="mt-6">
          {/* A2 — explicabilidade mínima de fundamentação (estado + nº de evidências reais). */}
          <GroundingNotice grounding={reviewable.data?.draft?.grounding ?? null} />
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Revisão obrigatória.</strong> Rascunho editável (revisão humana) — gerado com base no
            processo ou importado. Edite e salve; a emissão oficial exige revisão de um terceiro (SoD).
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-2 font-semibold text-foreground">{draft.title}</h2>
            {/* C.4B.3B — edição humana governada do rascunho persistido. */}
            <DraftEditor processId={processId} kind="tr" content={draft.content} contentHash={draft.contentHash} />
          </div>
        </div>
      )}

      {/* C.4B.1/C.4B.2 — autoridade oficial: revisão pré-emissão do conteúdo exato + emissão governada. */}
      <OfficialPromotionSection processId={processId} kind="tr" reviewSnapshot={reviewable.data?.draft ?? null} />
    </div>
  );
}
