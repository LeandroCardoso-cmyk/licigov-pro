import { useState, useMemo } from "react";
import TaskDetailModal from "@/components/TaskDetailModal";
import { trpc } from "@/lib/trpc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Calendar,
  Search,
  Download,
  FileText,
} from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";

type TaskStatus = "pendente" | "em_andamento" | "pausada" | "atrasada" | "aguardando_informacao" | "concluida" | "cancelada";
type TaskPriority = "baixa" | "media" | "alta" | "urgente";

interface Task {
  id: number;
  title: string;
  description: string | null;
  type: string;
  status: TaskStatus;
  priority: TaskPriority;
  deadline: Date | null;
  assignedTo: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const STATUS_CONFIG: Record<TaskStatus, { label: string; color: string }> = {
  pendente: { label: "Pendente", color: "bg-gray-500" },
  em_andamento: { label: "Em Andamento", color: "bg-blue-500" },
  pausada: { label: "Pausada", color: "bg-yellow-500" },
  atrasada: { label: "Atrasada", color: "bg-red-500" },
  aguardando_informacao: { label: "Aguardando Info", color: "bg-orange-500" },
  concluida: { label: "Concluída", color: "bg-green-500" },
  cancelada: { label: "Cancelada", color: "bg-gray-400" },
};

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  baixa: { label: "Baixa", color: "bg-gray-500" },
  media: { label: "Média", color: "bg-blue-500" },
  alta: { label: "Alta", color: "bg-orange-500" },
  urgente: { label: "Urgente", color: "bg-red-500" },
};

function getDeadlineColor(deadline: Date | null): string {
  if (!deadline) return "text-gray-500";
  
  const now = new Date();
  const daysUntilDeadline = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  
  if (daysUntilDeadline < 0) return "text-red-600 font-bold";
  if (daysUntilDeadline <= 2) return "text-red-500";
  if (daysUntilDeadline <= 7) return "text-orange-500";
  if (daysUntilDeadline <= 15) return "text-yellow-600";
  return "text-green-600";
}

export default function TaskList() {
  const [searchText, setSearchText] = useState("");
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  const { data: tasks = [], isLoading } = trpc.departmentTasks.list.useQuery();

  // Filtrar tarefas por busca
  const filteredTasks = useMemo(() => {
    if (!searchText.trim()) return tasks;
    
    const searchLower = searchText.toLowerCase();
    return tasks.filter(
      (task) =>
        task.title.toLowerCase().includes(searchLower) ||
        task.description?.toLowerCase().includes(searchLower) ||
        task.type?.toLowerCase().includes(searchLower)
    );
  }, [tasks, searchText]);

  const handleExportPDF = () => {
    // TODO: Implementar exportação PDF
    alert("Exportação PDF em desenvolvimento");
  };

  const handleExportExcel = () => {
    // TODO: Implementar exportação Excel
    alert("Exportação Excel em desenvolvimento");
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando tarefas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filtros e Ações */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Busca e Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por título, descrição ou tipo..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleExportPDF}>
                <FileText className="h-4 w-4 mr-2" />
                PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportExcel}>
                <Download className="h-4 w-4 mr-2" />
                Excel
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {filteredTasks.length} {filteredTasks.length === 1 ? "tarefa" : "tarefas"} no total
          </p>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">ID</TableHead>
                  <TableHead className="min-w-[250px]">Título</TableHead>
                  <TableHead className="min-w-[150px]">Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prioridade</TableHead>
                  <TableHead className="min-w-[150px]">Prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      {searchText ? "Nenhuma tarefa encontrada para a busca" : "Nenhuma tarefa cadastrada"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTasks.map((task) => (
                    <TableRow 
                      key={task.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <TableCell className="font-mono text-xs">#{task.id}</TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{task.title}</div>
                          {task.description && (
                            <div className="text-xs text-muted-foreground line-clamp-1 mt-1">
                              {task.description}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{task.type || "—"}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${STATUS_CONFIG[task.status].color} text-white text-xs`}>
                          {STATUS_CONFIG[task.status].label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`${PRIORITY_CONFIG[task.priority].color} text-white text-xs`}>
                          {PRIORITY_CONFIG[task.priority].label}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {task.deadline ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 text-sm">
                              <Calendar className="h-3.5 w-3.5" />
                              {format(new Date(task.deadline), "dd/MM/yyyy")}
                            </div>
                            <span className={`text-xs ${getDeadlineColor(new Date(task.deadline))}`}>
                              {formatDistanceToNow(new Date(task.deadline), { addSuffix: true, locale: ptBR })}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <TaskDetailModal
        taskId={selectedTaskId}
        open={selectedTaskId !== null}
        onClose={() => setSelectedTaskId(null)}
      />
    </div>
  );
}
