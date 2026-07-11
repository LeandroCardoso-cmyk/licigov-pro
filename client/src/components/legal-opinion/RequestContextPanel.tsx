import React from "react";
import { domainLabel } from "./labels";

/**
 * RequestContextPanel — PRESENTATIONAL.
 *
 * Exibe o contexto carregado AUTOMATICAMENTE ao abrir a solicitação: documentos
 * referenciados (nunca cópia), reasoning, explainability, riscos, recomendações e
 * snapshots. Toda recomendação é revisável — nunca vira parecer automaticamente.
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
  loading?: boolean;
}

export default function RequestContextPanel({
  documents = [], reasoning, explainability = "", risks = [], recommendations = [], snapshots = [], confidence = 0, loading = false,
}: RequestContextPanelProps) {
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

      <section className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-indigo-900">Reasoning &amp; Explainability</h3>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
            confiança {Math.round(confidence * 100)}%
          </span>
        </div>
        <p className="text-sm text-gray-800">{reasoning?.summary || "Sem reasoning gerado."}</p>
        {explainability && <p className="mt-2 text-xs text-gray-600">{explainability}</p>}
        <p className="mt-2 text-[11px] italic text-indigo-700">Recomendação revisável — nunca emite parecer automaticamente.</p>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Riscos</h4>
          {risks.length === 0 ? <p className="text-xs text-gray-400">Nenhum.</p> : (
            <ul className="space-y-1 text-sm text-gray-700">{risks.map((r, i) => <li key={i}>• {r}</li>)}</ul>
          )}
        </section>
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Recomendações</h4>
          {recommendations.length === 0 ? <p className="text-xs text-gray-400">Nenhuma.</p> : (
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
