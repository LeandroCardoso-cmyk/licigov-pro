import React from "react";

interface WorkflowStep { name: string; status: string; approvalRequired: boolean; }
interface Props { workflowId?: string; steps?: WorkflowStep[]; requiresHumanIntervention?: boolean; pendingApprovals?: string[]; }

const STATUS_COLOR: Record<string, string> = { completed: "green", failed: "red", pending_approval: "orange", blocked: "darkred" };

export function AutonomousWorkflowViewer({ workflowId = "", steps = [], requiresHumanIntervention = false, pendingApprovals = [] }: Props) {
  return (
    <div>
      <h4>Workflow Autônomo <code style={{ fontSize: 10 }}>{workflowId.slice(0, 12)}...</code></h4>
      {requiresHumanIntervention && <p style={{ color: "orange" }}>⚠ Requer intervenção humana — {pendingApprovals.length} aprovação(ões) pendente(s)</p>}
      <ul>
        {steps.map(s => (
          <li key={s.name} style={{ color: STATUS_COLOR[s.status] ?? "gray" }}>
            {s.name}: {s.status}{s.approvalRequired ? " (aprovação requerida)" : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
