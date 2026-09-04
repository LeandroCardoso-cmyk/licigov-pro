import React from "react";
import { domainLabel } from "./labels";
import type { ReasoningViewState } from "./legalOpinionQueryOrchestration";

/**
 * RequestContextPanel — PRESENTATIONAL.
 *
 * Exibe o contexto carregado AUTOMATICAMENTE ao abrir a solicitação: documentos
 * referenciados (nunca cópia), reasoning, explainability, riscos, recomendações e
 * snapshots. Toda recomendação é revisável — nunca vira parecer automaticamente.
 *
 * O CONTEÚDO OPERACIONAL (documentos, snapshots) vem de `loadContext` e aparece
 * imediatamente. O Reasoning & Explainability (apoio) chega SEPARADO, guiado por
 * `reasoningState` (idle → loading → ready | error): enquanto o Copiloto Jurídico
 * processa, só o bloco de reasoning mostra skeleton; se FALHAR, um estado
 * institucional explícito é exibido (nunca confiança 0% / "sem reasoning" como se
 * fosse resultado válido) e o conteúdo operacional permanece plenamente utilizável.
 */

export interface DocumentRef {
  id: string;
  title: string;
  originDomain: string;
  documentId: string;
  version: number;
  snapshot: string;
}

export interface RequestContextPanelProps {
  documents?: DocumentRef[];
  reasoning?: { summary: string; inferences: readonly string[] };
  explainability?: string;
  risks?: readonly string[];
  recommendations?: readonly string[];
  snapshots?: readonly string[];
  confidence?: number;
  /** Skeleton do conteúdo operacional inteiro (documentos ainda carregando). */
  loading?: boolean;
  /** Estado do bloco de apoio cognitivo (carregado à parte de loadContext). */
  reasoningState?: ReasoningViewState;
  /** Ação de "Tentar novamente" (refetch do TanStack Query), oferecida só no estado de erro. */
  onRetryReasoning?: () => void;
}

export default function RequestContextPanel({
  documents = [], reasoning, explainability = "", risks = [], recommendations = [], snapshots = [], confidence = 0,
  loading = false, reasoningState = "ready", onRetryReasoning,
}: RequestContextPanelProps) {
  const reasoningLoading = reasoningState === "loading" || reasoningState === "idle";
  const reasoningError = reasoningState === "error";
  if (loading) {
    return (
      <div className="animate-pulse space-y-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="h-4 w-1/3 rounded bg-gray-200" />
        <div className="h-16 w-full rounded bg-gray-100" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-1 text-sm font-semibold text-gray-900">Documentos referenciados</h3>
        <p className="mb-3 text-xs text-amber-600">Por referência — sem cópia. Permanecem no domínio de origem.</p>
        {documents.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhum documento referenciado.</p>
        ) : (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-800">{d.title || d.documentId}</p>
                  <p className="text-xs text-gray-500">Origem: {domainLabel(d.originDomain)} · v{d.version}</p>
                </div>
                <span className="font-mono text-[10px] text-gray-400">{d.snapshot.slice(0, 10)}…</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`rounded-lg border p-4 ${reasoningError ? "border-amber-200 bg-amber-50/50" : "border-indigo-100 bg-indigo-50/40"}`}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className={`text-sm font-semibold ${reasoningError ? "text-amber-900" : "text-indigo-900"}`}>Reasoning &amp; Explainability</h3>
          {reasoningError ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
              apoio indisponível
            </span>
          ) : reasoningLoading ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-500 ring-1 ring-inset ring-indigo-200">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400" /> processando…
            </span>
          ) : (
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
              confiança {Math.round(confidence * 100)}%
            </span>
          )}
        </div>
        {reasoningError ? (
          // FALHA/indisponibilidade do apoio cognitivo — NUNCA apresentada como resultado
          // vazio válido. O conteúdo operacional acima permanece plenamente utilizável.
          <div className="space-y-2">
            <p className="text-sm text-amber-800">
              Apoio cognitivo temporariamente indisponível. O conteúdo operacional permanece disponível.
            </p>
            {onRetryReasoning && (
              <button
                type="button"
                onClick={onRetryReasoning}
                className="inline-flex items-center rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
              >
                Tentar novamente
              </button>
            )}
          </div>
        ) : reasoningLoading ? (
          <div className="animate-pulse space-y-2">
            <div className="h-4 w-3/4 rounded bg-indigo-100" />
            <div className="h-3 w-1/2 rounded bg-indigo-100/70" />
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-800">{reasoning?.summary || "Sem reasoning gerado."}</p>
            {explainability && <p className="mt-2 text-xs text-gray-600">{explainability}</p>}
          </>
        )}
        {!reasoningError && (
          <p className="mt-2 text-[11px] italic text-indigo-700">Apoio à decisão — carregado à parte, revisável, nunca emite parecer automaticamente.</p>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Riscos</h4>
          {reasoningError ? (
            <p className="text-xs text-amber-600">Indisponível — apoio cognitivo offline.</p>
          ) : reasoningLoading ? (
            <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
          ) : risks.length === 0 ? <p className="text-xs text-gray-400">Nenhum.</p> : (
            <ul className="space-y-1 text-sm text-gray-700">{risks.map((r, i) => <li key={i}>• {r}</li>)}</ul>
          )}
        </section>
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Recomendações</h4>
          {reasoningError ? (
            <p className="text-xs text-amber-600">Indisponível — apoio cognitivo offline.</p>
          ) : reasoningLoading ? (
            <div className="h-4 w-2/3 animate-pulse rounded bg-gray-100" />
          ) : recommendations.length === 0 ? <p className="text-xs text-gray-400">Nenhuma.</p> : (
            <ul className="space-y-1 text-sm text-gray-700">{recommendations.map((r, i) => <li key={i}>• {r}</li>)}</ul>
          )}
        </section>
      </div>

      {snapshots.length > 0 && (
        <p className="text-[11px] text-gray-400">Snapshots de integridade: {snapshots.length} documento(s) verificável(is).</p>
      )}
    </div>
  );
}
