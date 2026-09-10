/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — Explicabilidade MÍNIMA de fundamentação (ETP/TR).
 *
 * Componente presentacional puro: mostra o ESTADO de fundamentação (grounded/partially/ungrounded) e o
 * número de evidências normativas reais usadas no rascunho. NÃO expõe prompt, payload, raciocínio bruto
 * nem segredos. Reforça a supervisão humana (o rascunho nunca é "aprovado" automaticamente).
 */

export type GroundingDescriptor = {
  state: string;
  evidenceCount: number;
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

export default function GroundingNotice({ grounding }: { grounding: GroundingDescriptor | null }) {
  if (!grounding) return null;
  const meta = LABELS[grounding.state] ?? { label: grounding.state, tone: "muted" as const };
  return (
    <div
      className={`mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-4 py-2 text-sm ${TONE_CLASS[meta.tone]}`}
      role="status"
    >
      <span className="font-medium">Fundamentação: {meta.label}</span>
      <span aria-hidden>·</span>
      <span>
        {grounding.evidenceCount} evidência{grounding.evidenceCount === 1 ? "" : "s"} normativa
        {grounding.evidenceCount === 1 ? "" : "s"} utilizada{grounding.evidenceCount === 1 ? "" : "s"}
      </span>
      {(meta.tone === "warn") && (
        <span className="basis-full text-xs opacity-90">
          Fundamentação incompleta — complementação e revisão obrigatórias pelo servidor competente.
        </span>
      )}
    </div>
  );
}
