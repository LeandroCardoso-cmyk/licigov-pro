import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, Plus } from "lucide-react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { SortableTaskCard } from "./SortableTaskCard";
import type { Task, TaskStatus } from "./TaskCard";

interface Column {
  id: TaskStatus;
  title: string;
  color: string;
}

interface Props {
  column: Column;
  tasks: Task[];
  onTaskClick: (taskId: number) => void;
}

export function KanbanColumn({ column, tasks, onTaskClick }: Props) {
  const taskIds = tasks.map((t) => t.id);

  return (
    <div className={`flex flex-col rounded-lg ${column.color} p-4 min-w-[300px] max-w-[350px]`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-sm">{column.title}</h3>
        <Badge variant="secondary" className="text-xs">{tasks.length}</Badge>
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
