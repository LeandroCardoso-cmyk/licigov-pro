import React, { useState } from "react";

interface Stage { name: string; status: "pending" | "running" | "completed" | "failed"; }
interface Props { agentType?: string; stages?: Stage[]; onExecute?: () => void; }

export function AgentExecutionPanel({ agentType = "generic", stages = [], onExecute }: Props) {
  const [running, setRunning] = useState(false);
  const handleExecute = () => { setRunning(true); onExecute?.(); setTimeout(() => setRunning(false), 1500); };
  return (
    <div style={{ border: "1px solid #333", borderRadius: 8, padding: 16 }}>
      <h3>Execução do Agente — {agentType}</h3>
      <button onClick={handleExecute} disabled={running}>{running ? "Executando..." : "Executar"}</button>
      <ul>
        {stages.map(s => (
          <li key={s.name} style={{ color: s.status === "completed" ? "green" : s.status === "failed" ? "red" : "gray" }}>
            {s.name}: {s.status}
          </li>
        ))}
      </ul>
    </div>
  );
}
