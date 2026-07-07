import React from "react";
import { domainLabel, PRIORITY_LABELS, PRIORITY_CLASSES } from "./RequestCard";

/**
 * AssignmentPanel — PRESENTATIONAL.
 *
 * Painel de distribuição interna de uma solicitação dentro do domínio de
 * destino: fila, setor, responsável e prioridade. A distribuição acontece
 * DEPOIS que o Request Engine encaminha — nenhum domínio distribui trabalho
 * em outro domínio.
 */

export interface AssignmentData {
  id: string;
  requestId: string;
  queue: string;
  sector: string | null;
  userId: number | null;
  priority: string;
  assignedAt: string;
}

export interface AssignmentPanelProps {
  assignment?: AssignmentData;
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MOCK_ASSIGNMENT: AssignmentData = {
  id: "asg-0001",
  requestId: "req-0001",
  queue: "parecer_juridico",
  sector: "Assessoria Jurídica",
  userId: 42,
  priority: "alta",
  assignedAt: new Date().toISOString(),
};

export default function AssignmentPanel({ assignment = MOCK_ASSIGNMENT }: AssignmentPanelProps) {
  const priorityClass = PRIORITY_CLASSES[assignment.priority] ?? PRIORITY_CLASSES.media;

  const rows: Array<{ label: string; value: string }> = [
    { label: "Fila", value: domainLabel(assignment.queue) },
    { label: "Setor", value: assignment.sector ?? "Não atribuído" },
    { label: "Responsável", value: assignment.userId ? `Usuário #${assignment.userId}` : "Aguardando atribuição" },
    { label: "Distribuída em", value: formatDateTime(assignment.assignedAt) },
  ];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Distribuição interna</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${priorityClass}`}>
          {PRIORITY_LABELS[assignment.priority] ?? assignment.priority}
        </span>
      </div>

      <dl className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between border-b border-gray-50 pb-2 last:border-0">
            <dt className="text-xs text-gray-500">{row.label}</dt>
            <dd className="text-sm font-medium text-gray-800">{row.value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11px] text-gray-400">
        A distribuição ocorre dentro do domínio de destino, após o encaminhamento institucional.
      </p>
    </div>
  );
}
