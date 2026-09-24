/**
 * Hierarquia visual da revisão: observações da extração e ações técnicas ficam SECUNDÁRIAS (recolhidas), sem
 * ocultar informação. Advertências operacionais (pedem ação) ficam destacadas; informações técnicas de layout
 * ficam em "observações da extração". O reprocessamento governado continua disponível em "Ações da extração"
 * (elegibilidade, confirmação, motivo e auditoria inalterados) — e aparece em destaque só enquanto em andamento.
 */
import React from "react";
import { AlertTriangle, Info, Settings2 } from "lucide-react";
import { splitWarnings } from "@/lib/ingestion/priceResearchReview";
import { describeReprocess, type ReprocessStatusLike } from "@/lib/ingestion/reprocess";
import { ReprocessExtractionPanel } from "./ReprocessExtractionPanel";

export interface ExtractionWarning { code?: string; message?: string; severity?: string }

export function ExtractionObservationsPanel({ warnings }: { warnings: ExtractionWarning[] }) {
  const { operational, technical } = splitWarnings(warnings);
  if (operational.length === 0 && technical.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="extraction-observations">
      {operational.length > 0 && (
        <details className="group rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {operational.length} advertência(s) da extração — conferir na revisão
            <span className="ml-auto text-xs font-normal underline">Ver detalhes</span>
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
            {operational.map((w, i) => <li key={`${w.code ?? "w"}-${i}`}>{w.message ?? w.code}</li>)}
          </ul>
        </details>
      )}
      {technical.length > 0 && (
        <details className="rounded-md border border-border p-2 text-muted-foreground">
          <summary className="flex cursor-pointer items-center gap-2 text-sm">
            <Info className="size-4" aria-hidden="true" />
            {technical.length} observação(ões) técnica(s) da extração
            <span className="ml-auto text-xs underline">Ver detalhes</span>
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-6 text-sm">
            {technical.map((w, i) => <li key={`${w.code ?? "i"}-${i}`}>{w.message ?? w.code}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

interface ExtractionActionsProps {
  reprocess: ReprocessStatusLike | null | undefined;
  isReprocessing: boolean;
  error: string | null;
  onReprocess: (reason: string) => void;
}

/** Ações técnicas da extração (secundárias). Em andamento, o aviso de reprocessamento fica visível. */
export function ExtractionActionsPanel(props: ExtractionActionsProps) {
  const view = describeReprocess(props.reprocess);
  if (view.inProgress) return <ReprocessExtractionPanel {...props} />;
  if (!view.showAction) return null;
  return (
    <details className="rounded-md border border-border p-2" data-testid="extraction-actions">
      <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
        <Settings2 className="size-4" aria-hidden="true" /> Ações da extração
      </summary>
      <div className="mt-2">
        <ReprocessExtractionPanel {...props} />
      </div>
    </details>
  );
}
