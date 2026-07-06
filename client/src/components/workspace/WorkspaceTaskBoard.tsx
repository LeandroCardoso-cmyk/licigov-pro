import React from "react";

type TaskStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "in_review"
  | "done"
  | "cancelled";

type TaskPriority = "baixa" | "media" | "alta" | "urgente";

export interface WorkspaceTask {
  id: string;
  taskType: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  assignedCopilot?: string | null;
  approvalRequired: boolean;
}

interface WorkspaceTaskBoardProps {
  tasks?: WorkspaceTask[];
}

const DEFAULT_TASKS: WorkspaceTask[] = [
  {
    id: "t1",
    taskType: "elaboracao_dfd",
    title: "Elaborar DFD inicial",
    status: "pending",
    priority: "alta",
    assignedCopilot: "planejamento",
    approvalRequired: true,
  },
  {
    id: "t2",
    taskType: "pesquisa_precos",
    title: "Pesquisa de preços de mercado",
    status: "in_progress",
    priority: "media",
    assignedCopilot: "pesquisa_precos",
    approvalRequired: false,
  },
  {
    id: "t3",
    taskType: "revisao_tr",
    title: "Revisar Termo de Referência",
    status: "blocked",
    priority: "urgente",
    assignedCopilot: "tr_intelligence",
    approvalRequired: true,
  },
  {
    id: "t4",
    taskType: "parecer",
    title: "Parecer jurídico preliminar",
    status: "in_review",
    priority: "alta",
    assignedCopilot: "juridico",
    approvalRequired: true,
  },
  {
    id: "t5",
    taskType: "conferencia",
    title: "Conferência de conformidade",
    status: "done",
    priority: "baixa",
    assignedCopilot: "controle_interno",
    approvalRequired: false,
  },
];

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: "pending", label: "Pendente" },
  { key: "in_progress", label: "Em Andamento" },
  { key: "blocked", label: "Bloqueada" },
  { key: "in_review", label: "Em Revisão" },
  { key: "done", label: "Concluída" },
];

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  baixa: "bg-green-100 text-green-700",
  media: "bg-yellow-100 text-yellow-700",
  alta: "bg-orange-100 text-orange-700",
  urgente: "bg-red-100 text-red-700",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

const COLUMN_ACCENT: Record<TaskStatus, string> = {
  pending: "border-t-gray-400",
  in_progress: "border-t-blue-500",
  blocked: "border-t-red-500",
  in_review: "border-t-amber-500",
  done: "border-t-green-500",
  cancelled: "border-t-gray-400",
};

export default function WorkspaceTaskBoard({
  tasks = DEFAULT_TASKS,
}: WorkspaceTaskBoardProps) {
  return (
    <div className="p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Quadro de Tarefas
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {COLUMNS.map((col) => {
          const columnTasks = tasks.filter((t) => t.status === col.key);
          return (
            <div
              key={col.key}
              className={`rounded-lg border-t-4 bg-gray-50 p-3 ${COLUMN_ACCENT[col.key]}`}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  {col.label}
                </h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500">
                  {columnTasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {columnTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-md border border-gray-200 bg-white p-3 shadow-sm"
                  >
                    <p className="text-sm font-medium text-gray-900">
                      {task.title}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PRIORITY_STYLES[task.priority]}`}
                      >
                        {PRIORITY_LABELS[task.priority]}
                      </span>
                      {task.assignedCopilot && (
                        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] font-medium text-indigo-600">
                          {task.assignedCopilot}
                        </span>
                      )}
                      {task.approvalRequired && (
                        <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-orange-600">
                          Requer aprovação
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {columnTasks.length === 0 && (
                  <p className="py-4 text-center text-xs text-gray-400">
                    Vazio
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
