import React from "react";
import { CONCLUSION_LABELS } from "./labels";

/**
 * LegalOpinionViewer — PRESENTATIONAL.
 *
 * Visualização somente-leitura do parecer emitido: relatório, fundamentação,
 * conclusão, recomendações, ressalvas e situação de assinatura.
 */

export interface OpinionDraftView {
  opinionType: string;
  report: string;
  foundation: string;
  conclusion: string;
  conclusionType: string | null;
  recommendations: readonly string[];
  reservations: readonly string[];
  attachments: readonly string[];
  status: string;
  version: number;
  signed: boolean;
  signatureMethod: string | null;
}

export interface LegalOpinionViewerProps {
  draft?: OpinionDraftView | null;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-gray-100 py-3 last:border-0">
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      {children}
    </section>
  );
}

export default function LegalOpinionViewer({ draft = null }: LegalOpinionViewerProps) {
  if (!draft) {
    return <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-400">Nenhum parecer elaborado ainda.</div>;
  }
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold text-gray-900">Parecer Jurídico</h3>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">v{draft.version}</span>
          {draft.signed ? (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Assinado ({draft.signatureMethod})</span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Não assinado</span>
          )}
        </div>
      </header>

      <Section title="Relatório"><p className="whitespace-pre-wrap text-sm text-gray-800">{draft.report || "—"}</p></Section>
      <Section title="Fundamentação"><p className="whitespace-pre-wrap text-sm text-gray-800">{draft.foundation || "—"}</p></Section>
      <Section title="Conclusão">
        <p className="whitespace-pre-wrap text-sm text-gray-800">{draft.conclusion || "—"}</p>
        {draft.conclusionType && (
          <span className="mt-1 inline-block rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
            {CONCLUSION_LABELS[draft.conclusionType] ?? draft.conclusionType}
          </span>
        )}
      </Section>
      {draft.recommendations.length > 0 && (
        <Section title="Recomendações"><ul className="list-disc pl-5 text-sm text-gray-800">{draft.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul></Section>
      )}
      {draft.reservations.length > 0 && (
        <Section title="Ressalvas"><ul className="list-disc pl-5 text-sm text-gray-800">{draft.reservations.map((r, i) => <li key={i}>{r}</li>)}</ul></Section>
      )}
    </div>
  );
}
