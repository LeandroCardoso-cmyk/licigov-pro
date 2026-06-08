import React, { useState } from "react";

interface RollbackStep { id: string; description: string; stepOrder: number; isReversible: boolean; }
interface Props { steps?: RollbackStep[]; estimatedDurationMs?: number; onSimulate?: () => void; }

export function RollbackSimulationPanel({ steps = [], estimatedDurationMs = 0, onSimulate }: Props) {
  const [simulated, setSimulated] = useState(false);
  return (
    <div style={{ border: "1px solid #c44", padding: 16 }}>
      <h4>Simulação de Rollback</h4>
      <p>Etapas: {steps.length} | Duração estimada: {estimatedDurationMs}ms</p>
      <button onClick={() => { setSimulated(true); onSimulate?.(); }}>Simular Rollback</button>
      {simulated && (
        <ol>
          {steps.sort((a, b) => a.stepOrder - b.stepOrder).map(s => (
            <li key={s.id}>{s.description} {s.isReversible ? "✓" : "✗"}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
