import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

/**
 * RC-5.1 — "Tirar Dúvidas" (Institutional Consultation) · Home.
 *
 * Ferramenta OFICIAL de consulta técnica normativa — NÃO um chat genérico. Toda resposta é
 * fundamentada, explicável e auditável, construída pelo fluxo institucional (ContextPackage →
 * AIExecutionEngine) sobre o Official Knowledge Corpus. Prioriza clareza e confiança institucional.
 */

type ConsultationAnswer = {
  answerId: string;
  answer: string;
  hasSufficientBasis: boolean;
  foundation: readonly { reference: string; authority: string; jurisdiction: string; bindingLevel: string; version: string }[];
  documents: readonly { documentId: string; title: string; authority: string; jurisdiction: string; version: string; bindingLevel: string }[];
  passages: readonly { documentId: string; identifier: string; text: string; score: number }[];
  citations: readonly { reference: string; authority: string; jurisdiction: string; version: string; bindingLevel: string }[];
  observations: readonly string[];
  explainabilityLines: readonly string[];
  limitations: readonly string[];
  correlationId: string;
  replayId: string;
};

const JURIS_LABEL: Record<string, string> = { federal: "Federal", estadual: "Estadual", municipal: "Municipal" };
const JURIS_BADGE: Record<string, string> = {
  federal: "bg-blue-50 text-blue-700 border-blue-200",
  estadual: "bg-emerald-50 text-emerald-700 border-emerald-200",
  municipal: "bg-amber-50 text-amber-700 border-amber-200",
};

export default function TirarDuvidasHome() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ConsultationAnswer | null>(null);

  const suggestionsQuery = trpc.institutionalConsultation.suggestions.useQuery();
  const ask = trpc.institutionalConsultation.ask.useMutation({
    onSuccess: (data) => setAnswer(data.answer as ConsultationAnswer),
  });

  const submit = (q: string) => {
    const value = q.trim();
    if (value.length < 3) return;
    setQuestion(value);
    ask.mutate({ question: value });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Campo principal — não parece um chat comum: é uma consulta oficial */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <label htmlFor="duvida" className="block text-sm font-semibold text-gray-800">Digite sua dúvida</label>
        <p className="mt-1 text-xs text-gray-500">Consulta técnica fundamentada na legislação, nos Tribunais de Contas e nas normas do seu município.</p>
        <textarea
          id="duvida"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(question); }}
          rows={3}
          placeholder="Ex.: Posso realizar contratação direta neste caso?"
          className="mt-3 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-gray-400">Ctrl/⌘ + Enter para perguntar</span>
          <button
            onClick={() => submit(question)}
            disabled={ask.isPending || question.trim().length < 3}
            className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {ask.isPending ? "Consultando…" : "Perguntar"}
          </button>
        </div>
      </div>

      {/* Sugestões iniciais (expansíveis) */}
      {!answer && !ask.isPending && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-gray-800">Sugestões de consulta</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(suggestionsQuery.data?.suggestions ?? []).map((s) => (
              <button key={s} onClick={() => submit(s)} className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-700 hover:border-indigo-300 hover:bg-indigo-50">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {ask.isPending && <div className="h-40 animate-pulse rounded-lg bg-gray-100" />}

      {ask.isError && (
        <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
          {ask.error?.message ?? "Falha na consulta."}
        </div>
      )}

      {/* Resposta fundamentada */}
      {answer && !ask.isPending && (
        <div className="space-y-4">
          {/* Resposta elaborada */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900">Resposta</h2>
              {answer.hasSufficientBasis
                ? <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Fundamentada</span>
                : <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">Sem base suficiente</span>}
            </div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{answer.answer}</p>
          </div>

          {/* Explainability */}
          {answer.explainabilityLines.length > 0 && (
            <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-5">
              <h3 className="text-sm font-semibold text-indigo-900">Esta resposta foi construída utilizando</h3>
              <ul className="mt-2 space-y-1 text-sm text-indigo-900">
                {answer.explainabilityLines.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
          )}

          {/* Fundamentação (documentos utilizados) */}
          {answer.documents.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-800">Documentos utilizados</h3>
              <div className="mt-3 space-y-2">
                {answer.documents.map((d) => (
                  <div key={d.documentId} className="flex flex-wrap items-center gap-2 rounded-md border border-gray-100 px-3 py-2 text-sm">
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${JURIS_BADGE[d.jurisdiction] ?? "bg-gray-50 text-gray-600 border-gray-200"}`}>{JURIS_LABEL[d.jurisdiction] ?? d.jurisdiction}</span>
                    <span className="font-medium text-gray-800">{d.title}</span>
                    <span className="text-xs text-gray-500">· {d.authority} · v{d.version} · {d.bindingLevel}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trechos utilizados (texto oficial verbatim) */}
          {answer.passages.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-800">Trechos utilizados</h3>
              <div className="mt-3 space-y-3">
                {answer.passages.map((p, i) => (
                  <blockquote key={`${p.documentId}-${p.identifier}-${i}`} className="border-l-2 border-indigo-200 pl-3">
                    <div className="text-xs font-medium text-indigo-700">{p.identifier}</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{p.text}</p>
                  </blockquote>
                ))}
              </div>
            </div>
          )}

          {/* Citações */}
          {answer.citations.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-gray-800">Citações</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                {answer.citations.map((c, i) => <li key={`${c.reference}-${i}`}>{c.reference} <span className="text-xs text-gray-400">({c.authority}, v{c.version})</span></li>)}
              </ul>
            </div>
          )}

          {/* Observações & Limitações */}
          {(answer.observations.length > 0 || answer.limitations.length > 0) && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-5">
              {answer.limitations.length > 0 && (
                <div className="mb-2">
                  <h3 className="text-sm font-semibold text-amber-800">Limitações</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800">{answer.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
                </div>
              )}
              <h3 className="text-sm font-semibold text-gray-700">Observações</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-600">{answer.observations.map((o) => <li key={o}>{o}</li>)}</ul>
              <p className="mt-3 text-[11px] text-gray-400">Auditoria · correlationId {answer.correlationId} · replayId {answer.replayId}</p>
            </div>
          )}

          <button onClick={() => { setAnswer(null); setQuestion(""); }} className="text-sm text-indigo-600 hover:underline">Fazer nova consulta</button>
        </div>
      )}
    </div>
  );
}
