import React from "react";

interface Task { id: string; taskName: string; priority: string; status: string; estimatedMs: number; }
interface Plan { planName: string; estimatedDurationMs: number; tasks: Task[]; status: string; }
interface Props { plan?: Plan; }

export function ExecutionPlanViewer({ plan }: Props) {
  if (!plan) return <p>Nenhum plano carregado.</p>;
  return (
    <div>
      <h4>Plano: {plan.planName}</h4>
      <p>Status: {plan.status} | Duração estimada: {plan.estimatedDurationMs}ms</p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead><tr><th>Tarefa</th><th>Prioridade</th><th>Status</th><th>Est. (ms)</th></tr></thead>
        <tbody>
          {plan.tasks.map(t => (
            <tr key={t.id}><td>{t.taskName}</td><td>{t.priority}</td><td>{t.status}</td><td>{t.estimatedMs}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
