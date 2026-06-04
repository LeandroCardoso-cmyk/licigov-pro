import React from "react";

interface Props {
  pilotScore:    number;
  phaseProgress: number;
  nextPhaseEta:  string | null;
}

export function PilotScoreCard({ pilotScore, phaseProgress, nextPhaseEta }: Props) {
  const progressPercent = Math.round(phaseProgress * 100);
  const scoreColor = pilotScore >= 70 ? "#16a34a" : pilotScore >= 40 ? "#d97706" : "#dc2626";

  return (
    <div style={{ fontFamily: "sans-serif", background: "#f9fafb", borderRadius: 8, padding: "1.5rem", maxWidth: 360 }}>
      <h3 style={{ marginBottom: "1rem" }}>Score do Piloto</h3>

      <div style={{ textAlign: "center", marginBottom: "1rem" }}>
        <div style={{ fontSize: "3rem", fontWeight: 700, color: scoreColor }}>{pilotScore}</div>
        <div style={{ color: "#6b7280", fontSize: "0.875rem" }}>/ 100 pontos</div>
      </div>

      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem", marginBottom: 4 }}>
          <span>Progresso geral</span>
          <span>{progressPercent}%</span>
        </div>
        <div style={{ background: "#e5e7eb", borderRadius: 4, height: 8 }}>
          <div style={{ background: "#2563eb", height: 8, borderRadius: 4, width: `${progressPercent}%` }} />
        </div>
      </div>

      {nextPhaseEta && (
        <div style={{ fontSize: "0.875rem", color: "#16a34a", textAlign: "center" }}>
          Próxima fase estimada: {new Date(nextPhaseEta).toLocaleDateString("pt-BR")}
        </div>
      )}
      {!nextPhaseEta && (
        <div style={{ fontSize: "0.875rem", color: "#dc2626", textAlign: "center" }}>
          Criterios de avanço não atendidos ainda.
        </div>
      )}
    </div>
  );
}
