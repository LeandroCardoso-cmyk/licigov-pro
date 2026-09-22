import { useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { DocumentImportPanel } from "@/components/ingestion/DocumentImportPanel";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import AuthoringSourcesSummary from "./AuthoringSourcesSummary";
import OfficialPromotionSection from "./OfficialPromotionSection";
import DraftEditor from "./DraftEditor";
import GroundingNotice from "./GroundingNotice";

/**
 * ETPWorkspace — REAL (wired to tRPC).
 *
 * UX: o operador informa o objeto e o sistema GERA um rascunho a partir do processo. O rascunho é
 * PERSISTIDO em generated_documents (C.4A) e carregado de forma RELOAD-SAFE pela query canônica
 * `reviewableDraft` (C.4B.2) — o conteúdo reaparece após recarregar a página. A saída de IA é revisável
 * e validada por humano antes de virar autoridade institucional via emissão governada (C.4B.1).
 *
 * P0 piloto — ações distintas para o MESMO rascunho canônico: "Gerar ETP com base no processo" (contexto
 * real: processo + DFD, inclusive importado) e "Importar ETP existente" (projeção documental real de
 * PDF/DOCX → revisão → aprovação → rascunho). Edição humana governada via DraftEditor (C.4B.3B).
 */

export type ETPWorkspaceProps = {
  processId?: string;
  /** Abre a importação expandida (processo iniciado por "Importar ETP existente"). */
  startWithImport?: boolean;
};

export default function ETPWorkspace({ processId = "", startWithImport = false }: ETPWorkspaceProps) {
  const [object, setObject] = useState("");
  const utils = trpc.useUtils();
  const processQuery = trpc.procurementProcess.loadProcess.useQuery({ processId }, { enabled: !!processId });
  const processObject = processQuery.data?.process?.object ?? "";
  useEffect(() => { if (!object && processObject) setObject(processObject); }, [processObject]);

  const { key: etpKey, rotate: rotateEtpKey } = useIdempotencyKey();
  // C.4B.2 — leitura canônica RELOAD-SAFE do rascunho persistido (fonte única de verdade do conteúdo).
  const reviewable = trpc.procurementProcess.reviewableDraft.useQuery(
    { processId, kind: "etp" }, { enabled: !!processId },
  );
  const generateETP = trpc.procurementProcess.generateETP.useMutation({
    onSuccess: () => {
      rotateEtpKey();
      if (processId) {
        utils.procurementProcess.reviewableDraft.invalidate({ processId, kind: "etp" });
        utils.procurementProcess.authoringSourceState.invalidate({ processId, kind: "etp" });
      }
    },
  });
  const draft = reviewable.data?.draft ?? null;

  const handleGenerate = () => {
    if (!processId || !object.trim()) return;
    generateETP.mutate({ processId, object: object.trim(), idempotencyKey: etpKey });
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">
        ETP — Estudo Técnico Preliminar
      </h1>
      <p className="text-sm text-muted-foreground">Art. 18 da Lei 14.133/2021</p>

      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 font-medium text-foreground">Gerar ETP com base no processo</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          O sistema estrutura um rascunho a partir do processo (objeto e DFD, se houver). Rascunho editável e
          sujeito a revisão humana — nunca um documento oficial automático.
        </p>
        {processId && object.trim() && <div className="mb-3"><AuthoringSourcesSummary processId={processId} kind="etp" object={object} /></div>}
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-foreground">Objeto</span>
          <input
            type="text"
            value={object}
            onChange={(e) => setObject(e.target.value)}
            placeholder="Contratação de solução de conectividade"
            className="rounded-lg border border-input px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!processId || !object.trim() || generateETP.isPending}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {generateETP.isPending ? "Gerando..." : "Gerar ETP com base no processo"}
        </button>
        {!processId && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Selecione um processo para gerar o ETP.
          </p>
        )}
        {generateETP.isError && (
          <p className="mt-2 text-sm text-destructive">{generateETP.error?.message || "Falha ao gerar o ETP."}</p>
        )}
      </div>

      {/* Importar ETP existente — projeção documental real (PDF/DOCX) no MESMO motor de ingestão. */}
      {processId && (
        <div className="mt-5">
          <DocumentImportPanel
            kind="etp" processId={processId} defaultOpen={startWithImport}
            onPromoted={() => utils.procurementProcess.authoringSourceState.invalidate({ processId, kind: "etp" })}
          />
        </div>
      )}

      {draft && (
        <div className="mt-6">
          {/* A2 — explicabilidade mínima de fundamentação (estado + nº de evidências reais). */}
          <GroundingNotice grounding={reviewable.data?.draft?.grounding ?? null} />
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Revisão obrigatória.</strong> Rascunho editável (revisão humana). Edite e salve; a
            emissão oficial exige revisão de um terceiro (segregação de deveres).
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-2 font-semibold text-foreground">{draft.title}</h2>
            {/* C.4B.3B — edição humana governada do rascunho persistido. */}
            <DraftEditor processId={processId} kind="etp" content={draft.content} contentHash={draft.contentHash} />
          </div>
        </div>
      )}

      {/* C.4B.1/C.4B.2 — autoridade oficial: revisão pré-emissão do conteúdo exato + emissão governada. */}
      <OfficialPromotionSection processId={processId} kind="etp" reviewSnapshot={reviewable.data?.draft ?? null} />
    </div>
  );
}
