import { useState, useMemo } from "react";
import TaskDetailModal from "@/components/TaskDetailModal";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { trpc } from "@/lib/trpc";
import { TaskCard, type Task, type TaskStatus } from "@/components/task-kanban/TaskCard";
import { KanbanColumn } from "@/components/task-kanban/KanbanColumn";

const COLUMNS: { id: TaskStatus; title: string; color: string }[] = [
  { id: "pendente", title: "Pendente", color: "bg-gray-100 dark:bg-gray-800" },
  { id: "em_andamento", title: "Em Andamento", color: "bg-blue-50 dark:bg-blue-950" },
  { id: "pausada", title: "Pausada", color: "bg-yellow-50 dark:bg-yellow-950" },
  { id: "atrasada", title: "Atrasada", color: "bg-red-50 dark:bg-red-950" },
  { id: "aguardando_informacao", title: "Aguardando Info", color: "bg-orange-50 dark:bg-orange-950" },
  { id: "concluida", title: "Concluída", color: "bg-green-50 dark:bg-green-950" },
  { id: "cancelada", title: "Cancelada", color: "bg-gray-200 dark:bg-gray-700" },
];

export default function TaskKanban() {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data: tasks = [], isLoading } = trpc.departmentTasks.list.useQuery();
  const updateTaskMutation = trpc.departmentTasks.update.useMutation({
    onSuccess: () => utils.departmentTasks.list.invalidate(),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      pendente: [], em_andamento: [], pausada: [], atrasada: [],
      aguardando_informacao: [], concluida: [], cancelada: [],
    };
    tasks.forEach((task) => {
      grouped[task.status as TaskStatus]?.push(task);
    });
    return grouped;
  }, [tasks]);

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find((t) => t.id === event.active.id);
    if (task) setActiveTask(task);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;
    const taskId = active.id as number;
    const newStatus = over.id as TaskStatus;
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === newStatus) return;
    updateTaskMutation.mutate({ id: taskId, status: newStatus });
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
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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
