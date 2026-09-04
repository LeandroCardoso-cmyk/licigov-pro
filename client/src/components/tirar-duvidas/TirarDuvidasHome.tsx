import React, { useState } from "react";
import { Streamdown } from "streamdown";
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
  executionId: string;
  status: string;
  answer: string;
  hasSufficientBasis: boolean;
  evidenceSufficiency: "fundamentada" | "parcial" | "insuficiente";
  foundation: readonly { reference: string; authority: string; jurisdiction: string; bindingLevel: string; version: string }[];
  documents: readonly { documentId: string; title: string; authority: string; jurisdiction: string; version: string; bindingLevel: string }[];
  passages: readonly { documentId: string; identifier: string; text: string; score: number }[];
  citations: readonly { reference: string; authority: string; jurisdiction: string; version: string; bindingLevel: string }[];
  observations: readonly string[];
  explainabilityLines: readonly string[];
  limitations: readonly string[];
  correlationId: string;
  replayId: string | null;
};

const JURIS_LABEL: Record<string, string> = { federal: "Federal", estadual: "Estadual", municipal: "Municipal" };
const JURIS_BADGE: Record<string, string> = {
  federal: "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800",
  estadual: "bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
  municipal: "bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
};

export default function TirarDuvidasHome() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<ConsultationAnswer | null>(null);
  const [showPassages, setShowPassages] = useState(false);

  const suggestionsQuery = trpc.institutionalConsultation.suggestions.useQuery();
  const utils = trpc.useUtils();
  const historyQuery = trpc.institutionalConsultation.history.useQuery({ limit: 8 });
  const ask = trpc.institutionalConsultation.ask.useMutation({
    onSuccess: (data) => { setAnswer(data.answer as ConsultationAnswer); setShowPassages(false); void utils.institutionalConsultation.history.invalidate(); },
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
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <label htmlFor="duvida" className="block text-sm font-semibold text-foreground">Digite sua dúvida</label>
        <p className="mt-1 text-xs text-muted-foreground">Consulta técnica fundamentada na legislação, nos Tribunais de Contas e nas normas do seu município.</p>
        <textarea
          id="duvida"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(question); }}
          rows={3}
          placeholder="Ex.: Posso realizar contratação direta neste caso?"
          className="mt-3 w-full resize-y rounded-md border border-input px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Ctrl/⌘ + Enter para perguntar</span>
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
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Sugestões de consulta</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {(suggestionsQuery.data?.suggestions ?? []).map((s) => (
              <button key={s} onClick={() => submit(s)} className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs text-foreground hover:border-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Consultas recentes (histórico institucional durável) */}
      {!answer && !ask.isPending && (historyQuery.data?.entries?.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground">Consultas recentes</h2>
          <ul className="mt-3 divide-y divide-border">
            {historyQuery.data!.entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <button onClick={() => submit(e.question)} className="min-w-0 flex-1 truncate text-left text-sm text-foreground hover:text-indigo-700 dark:hover:text-indigo-300" title={e.question}>
                  {e.question}
                </button>
                <span className="shrink-0 text-[11px] text-muted-foreground">{new Date(e.createdAt).toLocaleDateString("pt-BR")}</span>
                {e.status === "limited"
                  ? <span className="shrink-0 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">limitada</span>
                  : e.status === "failed"
                    ? <span className="shrink-0 rounded-full border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-300">falha</span>
                    : <span className="shrink-0 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">fundamentada</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {ask.isPending && <div className="h-40 animate-pulse rounded-lg bg-muted" />}

      {ask.isError && (
        <div className="rounded-md border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {ask.error?.message ?? "Falha na consulta."}
        </div>
      )}

      {/* Resposta fundamentada */}
      {answer && !ask.isPending && (
        <div className="space-y-4">
          {/* Resposta elaborada */}
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground">Resposta</h2>
              {answer.evidenceSufficiency === "fundamentada"
                ? <span className="rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Fundamentada</span>
                : answer.evidenceSufficiency === "parcial"
                  ? <span className="rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">Resposta parcial</span>
                  : <span className="rounded-full border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-300">Evidência insuficiente</span>}
            </div>
            <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground">
              <Streamdown>{answer.answer}</Streamdown>
            </div>
          </div>

          {/* Explainability */}
          {answer.explainabilityLines.length > 0 && (
            <div className="rounded-lg border border-indigo-100 dark:border-indigo-900 bg-indigo-50/50 dark:bg-indigo-950/50 p-5">
              <h3 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">Esta resposta foi construída utilizando</h3>
              <ul className="mt-2 space-y-1 text-sm text-indigo-900 dark:text-indigo-200">
                {answer.explainabilityLines.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </div>
          )}

          {/* Fundamentação (documentos utilizados) */}
          {answer.documents.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Documentos utilizados</h3>
              <div className="mt-3 space-y-2">
                {answer.documents.map((d) => (
                  <div key={d.documentId} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${JURIS_BADGE[d.jurisdiction] ?? "bg-muted text-muted-foreground border-border"}`}>{JURIS_LABEL[d.jurisdiction] ?? d.jurisdiction}</span>
                    <span className="font-medium text-foreground">{d.title}</span>
                    <span className="text-xs text-muted-foreground">· {d.authority} · v{d.version} · {d.bindingLevel}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trechos utilizados (texto oficial verbatim) — recolhidos por padrão (resposta ≈ 1 página) */}
          {answer.passages.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5">
              <button
                type="button"
                onClick={() => setShowPassages((v) => !v)}
                className="flex w-full items-center justify-between text-sm font-semibold text-foreground"
              >
                <span>Trechos utilizados ({answer.passages.length})</span>
                <span className="text-xs font-normal text-indigo-600 dark:text-indigo-400 hover:underline">{showPassages ? "ocultar" : "ver trechos"}</span>
              </button>
              {showPassages && (
                <div className="mt-3 space-y-3">
                  {answer.passages.map((p, i) => (
                    <blockquote key={`${p.documentId}-${p.identifier}-${i}`} className="border-l-2 border-indigo-200 dark:border-indigo-800 pl-3">
                      <div className="text-xs font-medium text-indigo-700 dark:text-indigo-300">{p.identifier}</div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{p.text}</p>
                    </blockquote>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Citações */}
          {answer.citations.length > 0 && (
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Citações</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground">
                {answer.citations.map((c, i) => <li key={`${c.reference}-${i}`}>{c.reference} <span className="text-xs text-muted-foreground">({c.authority}, v{c.version})</span></li>)}
              </ul>
            </div>
          )}

          {/* Observações & Limitações */}
          {(answer.observations.length > 0 || answer.limitations.length > 0) && (
            <div className="rounded-lg border border-border bg-muted p-5">
              {answer.limitations.length > 0 && (
                <div className="mb-2">
                  <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200">Limitações</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-800 dark:text-amber-200">{answer.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
                </div>
              )}
              <h3 className="text-sm font-semibold text-foreground">Observações</h3>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{answer.observations.map((o) => <li key={o}>{o}</li>)}</ul>
              <p className="mt-3 text-[11px] text-muted-foreground">Auditoria · correlationId {answer.correlationId} · replayId {answer.replayId}</p>
            </div>
          )}

          <button onClick={() => { setAnswer(null); setQuestion(""); }} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">Fazer nova consulta</button>
        </div>
      )}
    </div>
  );
}
