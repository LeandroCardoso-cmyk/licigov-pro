import React from "react";

type PilotPhase = "onboarding" | "training" | "shadow_mode" | "live_pilot" | "evaluation" | "full_rollout";

const PHASES: PilotPhase[] = ["onboarding", "training", "shadow_mode", "live_pilot", "evaluation", "full_rollout"];

const PHASE_LABELS: Record<PilotPhase, string> = {
  onboarding:   "Onboarding",
  training:     "Treinamento",
  shadow_mode:  "Modo Sombra",
  live_pilot:   "Piloto Live",
  evaluation:   "Avaliação",
  full_rollout: "Rollout Total",
};

interface Props {
  currentPhase: PilotPhase;
}

export function PhaseProgressBar({ currentPhase }: Props) {
  const currentIdx = PHASES.indexOf(currentPhase);

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h3 style={{ marginBottom: "1rem" }}>Progresso do Piloto</h3>
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        {PHASES.map((phase, idx) => {
          const isDone    = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const color     = isDone ? "#16a34a" : isCurrent ? "#2563eb" : "#e5e7eb";
          const textColor = isDone || isCurrent ? "#fff" : "#9ca3af";

          return (
            <React.Fragment key={phase}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 90 }}>
                <div
                  style={{
                    width: 36, height: 36, borderRadius: "50%", background: color,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: textColor, fontWeight: 700, fontSize: "0.875rem",
                  }}
                >
                  {isDone ? "✓" : idx + 1}
                </div>
                <div
                  style={{
                    fontSize: "0.7rem", marginTop: 4, textAlign: "center",
                    color: isCurrent ? "#2563eb" : isDone ? "#16a34a" : "#9ca3af",
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  {PHASE_LABELS[phase]}
                </div>
              </div>
              {idx < PHASES.length - 1 && (
                <div style={{ flex: 1, height: 3, background: idx < currentIdx ? "#16a34a" : "#e5e7eb", marginBottom: 20 }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
