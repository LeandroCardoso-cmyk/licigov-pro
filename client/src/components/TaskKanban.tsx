import { useState, useMemo } from "react";
import TaskDetailModal from "@/components/TaskDetailModal";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Calendar, User, AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

type TaskStatus = "pendente" | "em_andamento" | "pausada" | "atrasada" | "aguardando_informacao" | "concluida" | "cancelada";
type TaskPriority = "baixa" | "media" | "alta" | "urgente";

interface Task {
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

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: "pendente", title: "Pendente", color: "bg-gray-100 dark:bg-gray-800" },
  { id: "em_andamento", title: "Em Andamento", color: "bg-blue-50 dark:bg-blue-950" },
  { id: "pausada", title: "Pausada", color: "bg-yellow-50 dark:bg-yellow-950" },
  { id: "atrasada", title: "Atrasada", color: "bg-red-50 dark:bg-red-950" },
  { id: "aguardando_informacao", title: "Aguardando Info", color: "bg-orange-50 dark:bg-orange-950" },
  { id: "concluida", title: "Concluída", color: "bg-green-50 dark:bg-green-950" },
  { id: "cancelada", title: "Cancelada", color: "bg-gray-200 dark:bg-gray-700" },
];

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
  
  if (daysUntilDeadline < 0) return "text-red-600 font-bold"; // Vencido
  if (daysUntilDeadline <= 2) return "text-red-500"; // Crítico (2 dias)
  if (daysUntilDeadline <= 7) return "text-orange-500"; // Atenção (7 dias)
  if (daysUntilDeadline <= 15) return "text-yellow-600"; // Alerta (15 dias)
  return "text-green-600"; // Normal
}

interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
}

interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
  onClick?: () => void;
}

function TaskCard({ task, isDragging = false, onClick }: TaskCardProps) {
  const deadlineColor = getDeadlineColor(task.deadline);
  
  return (
    <Card 
      onClick={onClick}
      className={`mb-3 cursor-pointer transition-shadow hover:shadow-md ${
        isDragging ? "opacity-50" : ""
      }`}
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
              <span>
                {formatDistanceToNow(task.deadline, { addSuffix: true, locale: ptBR })}
              </span>
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

interface SortableTaskCardProps {
  task: Task;
  onClick: () => void;
}

function SortableTaskCard({ task, onClick }: SortableTaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div {...attributes} {...listeners}>
        <TaskCard task={task} isDragging={isDragging} onClick={onClick} />
      </div>
    </div>
  );
}

interface KanbanColumnProps {
  column: typeof COLUMNS[0];
  tasks: Task[];
  onTaskClick: (taskId: number) => void;
}

function KanbanColumn({ column, tasks, onTaskClick }: KanbanColumnProps) {
  const taskIds = tasks.map((t) => t.id);

  return (
    <div className={`flex flex-col rounded-lg ${column.color} p-4 min-w-[300px] max-w-[350px]`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm">{column.title}</h3>
        <Badge variant="secondary" className="text-xs">
          {tasks.length}
        </Badge>
      </div>

      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px]">
          {tasks.map((task) => (
            <SortableTaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
          ))}
          {tasks.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-xs">Nenhuma tarefa</p>
            </div>
          )}
        </div>
      </SortableContext>

      <Button variant="ghost" size="sm" className="mt-3 w-full justify-start text-xs">
        <Plus className="h-4 w-4 mr-1" />
        Nova tarefa
      </Button>
    </div>
  );
}

export default function TaskKanban() {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data: tasks = [], isLoading } = trpc.departmentTasks.list.useQuery();
  const updateTaskMutation = trpc.departmentTasks.update.useMutation({
    onSuccess: () => {
      utils.departmentTasks.list.invalidate();
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      pendente: [],
      em_andamento: [],
      pausada: [],
      atrasada: [],
      aguardando_informacao: [],
      concluida: [],
      cancelada: [],
    };

    tasks.forEach((task) => {
      grouped[task.status as TaskStatus]?.push(task);
    });

    return grouped;
  }, [tasks]);

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) {
      setActiveTask(task);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);

    if (!over) return;

    const taskId = active.id as number;
    const newStatus = over.id as TaskStatus;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;

    updateTaskMutation.mutate({
      id: taskId,
      status: newStatus,
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="h-full">
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUMNS.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              tasks={tasksByStatus[column.id]}
              onTaskClick={setSelectedTaskId}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} isDragging /> : null}
        </DragOverlay>
      </DndContext>

      <TaskDetailModal
        taskId={selectedTaskId}
        open={selectedTaskId !== null}
        onClose={() => setSelectedTaskId(null)}
      />
    </div>
  );
}
