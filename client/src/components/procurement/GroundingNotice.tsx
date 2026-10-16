/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — Explicabilidade MÍNIMA de fundamentação (ETP/TR).
 *
 * Componente presentacional puro: mostra o ESTADO de fundamentação (grounded/partially/ungrounded) e o
 * número de evidências normativas reais usadas no rascunho. NÃO expõe prompt, payload, raciocínio bruto
 * nem segredos. Reforça a supervisão humana (o rascunho nunca é "aprovado" automaticamente).
 */
import { listFactualGaps } from "./factualGaps";

export type GroundingDescriptor = {
  state: string;
  evidenceCount: number;
  /** M8: lacunas factuais ([REVISAR: …]) no conteúdo atual — independentes da fundamentação normativa. */
  factualGaps?: number;
};

const LABELS: Record<string, { label: string; tone: "ok" | "warn" | "muted" }> = {
  grounded: { label: "Fundamentado", tone: "ok" },
  partially_grounded: { label: "Parcialmente fundamentado", tone: "warn" },
  ungrounded: { label: "Sem fundamentação recuperada", tone: "warn" },
  not_applicable: { label: "Não aplicável", tone: "muted" },
};

const TONE_CLASS: Record<"ok" | "warn" | "muted", string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warn: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  muted: "border-border bg-muted text-muted-foreground",
};

export default function GroundingNotice({ grounding, content }: { grounding: GroundingDescriptor | null; content?: string | null }) {
  if (!grounding) return null;
  const meta = LABELS[grounding.state] ?? { label: grounding.state, tone: "muted" as const };
  const gaps = listFactualGaps(content);
  return (
    <div
      className={`mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-2 text-sm ${TONE_CLASS[meta.tone]}`}
      role="status"
    >
      <span className="font-medium">Fundamentação normativa: {meta.label}</span>
      <span aria-hidden>·</span>
      <span>
        {grounding.evidenceCount} evidência{grounding.evidenceCount === 1 ? "" : "s"} normativa
        {grounding.evidenceCount === 1 ? "" : "s"} utilizada{grounding.evidenceCount === 1 ? "" : "s"}
      </span>
      {typeof grounding.factualGaps === "number" && (
        <>
          <span aria-hidden>·</span>
          <span data-testid="factual-sufficiency" className={grounding.factualGaps > 0 ? "font-medium text-amber-700 dark:text-amber-300" : undefined}>
            Suficiência factual: {grounding.factualGaps > 0 ? `pendente (${grounding.factualGaps} lacuna${grounding.factualGaps === 1 ? "" : "s"} [REVISAR])` : "sem lacunas marcadas"}
          </span>
        </>
      )}
      {typeof grounding.factualGaps === "number" && grounding.factualGaps > 0 && meta.tone === "ok" && (
        <span className="basis-full text-xs opacity-90">
          Base normativa recuperada, mas há fatos a completar: conclusões dependentes deles são preliminares até a revisão.
        </span>
      )}
      {(meta.tone === "warn") && (
        <span className="basis-full text-xs opacity-90">
          Fundamentação incompleta — complementação e revisão obrigatórias pelo servidor competente.
        </span>
      )}
      {gaps.length > 0 && (
        <details data-testid="factual-gap-list" className="basis-full text-xs">
          <summary className="cursor-pointer font-medium">
            O que falta completar ({gaps.length}) — fatos do processo ou decisões humanas; a IA não os presume
          </summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            {gaps.map((g, i) => (
              <li key={i}>
                {g.section ? <span className="font-medium">{g.section}: </span> : null}
                {g.text}
              </li>
            ))}
          </ol>
          <p className="mt-1 opacity-90">Substitua cada trecho [REVISAR: …] no editor abaixo pelo texto revisado e salve.</p>
        </details>
      )}
    </div>
  );
}
