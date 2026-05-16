import { Badge } from "@/components/ui/badge";
import { AlertCircle, Clock, FileText, Calendar, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const PRIORITY_COLORS: Record<string, string> = {
  baixa: "bg-slate-100 text-slate-700 border-slate-300",
  media: "bg-blue-100 text-blue-700 border-blue-300",
  alta: "bg-orange-100 text-orange-700 border-orange-300",
  urgente: "bg-red-100 text-red-700 border-red-300",
};

const PRIORITY_LABELS: Record<string, string> = {
  baixa: "Baixa", media: "Média", alta: "Alta", urgente: "Urgente",
};

const STATUS_COLORS: Record<string, string> = {
  pendente: "bg-slate-100 text-slate-700",
  em_andamento: "bg-blue-100 text-blue-700",
  pausada: "bg-yellow-100 text-yellow-700",
  atrasada: "bg-red-100 text-red-700",
  aguardando_informacao: "bg-purple-100 text-purple-700",
  concluida: "bg-green-100 text-green-700",
  cancelada: "bg-gray-100 text-gray-700",
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente", em_andamento: "Em Andamento", pausada: "Pausada",
  atrasada: "Atrasada", aguardando_informacao: "Aguardando Info",
  concluida: "Concluída", cancelada: "Cancelada",
};

interface Task {
  priority: string;
  status: string;
  type?: string | null;
  deadline?: Date | string | null;
  assignedTo?: string | number | null;
}

export function TaskInfoPanel({ task }: { task: Task }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <AlertCircle className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Prioridade:</span>
          <Badge className={PRIORITY_COLORS[task.priority]}>{PRIORITY_LABELS[task.priority]}</Badge>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Status:</span>
          <Badge className={STATUS_COLORS[task.status]}>{STATUS_LABELS[task.status]}</Badge>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Tipo:</span>
          <span>{task.type || "Não especificado"}</span>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Prazo:</span>
          <span>
            {task.deadline ? (
              <>
                {new Date(task.deadline).toLocaleDateString("pt-BR")} (
                {formatDistanceToNow(new Date(task.deadline), { addSuffix: true, locale: ptBR })})
              </>
            ) : "Sem prazo definido"}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Responsável:</span>
          <span>{task.assignedTo || "Não atribuído"}</span>
        </div>
      </div>
    </div>
  );
}
