import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TaskCard, type Task } from "./TaskCard";

interface Props {
  task: Task;
  onClick: () => void;
}

export function SortableTaskCard({ task, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      <div {...attributes} {...listeners}>
        <TaskCard task={task} isDragging={isDragging} onClick={onClick} />
      </div>
    </div>
  );
}
