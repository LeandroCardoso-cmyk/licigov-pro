import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

export type TaskStatus =
  | "pendente"
  | "em_andamento"
  | "pausada"
  | "atrasada"
  | "aguardando_informacao"
  | "concluida"
  | "cancelada";

export type TaskPriority = "baixa" | "media" | "alta" | "urgente";

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  deadline: Date | null;
  assignedTo: number | null;
  assignedToName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  baixa: { label: "Baixa", color: "bg-gray-500" },
  media: { label: "Média", color: "bg-blue-500" },
  alta: { label: "Alta", color: "bg-orange-500" },
  urgente: { label: "Urgente", color: "bg-red-500" },
};

function getDeadlineColor(deadline: Date | null): string {
  if (!deadline) return "text-gray-500";
  const days = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days < 0) return "text-red-600 font-bold";
  if (days <= 2) return "text-red-500";
  if (days <= 7) return "text-orange-500";
  if (days <= 15) return "text-yellow-600";
  return "text-green-600";
}

interface Props {
  task: Task;
  isDragging?: boolean;
  onClick?: () => void;
}

export function TaskCard({ task, isDragging = false, onClick }: Props) {
  const deadlineColor = getDeadlineColor(task.deadline);

  return (
    <Card
      onClick={onClick}
      className={`mb-3 cursor-pointer transition-shadow hover:shadow-md ${isDragging ? "opacity-50" : ""}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold line-clamp-2">{task.title}</CardTitle>
          <Badge className={`${PRIORITY_CONFIG[task.priority].color} text-white text-xs shrink-0`}>
            {PRIORITY_CONFIG[task.priority].label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
        )}
        <div className="flex flex-col gap-1.5 text-xs">
          {task.deadline && (
            <div className={`flex items-center gap-1.5 ${deadlineColor}`}>
              <Calendar className="h-3.5 w-3.5" />
              <span>{formatDistanceToNow(task.deadline, { addSuffix: true, locale: ptBR })}</span>
            </div>
          )}
          {task.assignedToName && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              <span>{task.assignedToName}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
