import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { TaskInfoPanel } from "@/components/task-detail/TaskInfoPanel";
import { TaskLinkedProcess } from "@/components/task-detail/TaskLinkedProcess";
import { TaskAttachments } from "@/components/task-detail/TaskAttachments";
import { TaskComments } from "@/components/task-detail/TaskComments";

interface TaskDetailModalProps {
  taskId: number | null;
  open: boolean;
  onClose: () => void;
}

export default function TaskDetailModal({ taskId, open, onClose }: TaskDetailModalProps) {
  const [commentText, setCommentText] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);
  const utils = trpc.useUtils();

  const { data: task, isLoading } = trpc.departmentTasks.getById.useQuery({ id: taskId! }, { enabled: !!taskId });
  const { data: comments = [] } = trpc.departmentTasks.listComments.useQuery({ taskId: taskId! }, { enabled: !!taskId });
  const { data: attachments = [] } = trpc.departmentTasks.listAttachments.useQuery({ taskId: taskId! }, { enabled: !!taskId });
  const { data: processes = [] } = trpc.departmentTasks.listProcesses.useQuery();
  const { data: linkedProcess } = trpc.departmentTasks.getProcess.useQuery(
    { id: task?.processId! },
    { enabled: !!task?.processId }
  );

  const linkProcessMutation = trpc.departmentTasks.linkProcess.useMutation({
    onSuccess: () => { utils.departmentTasks.getById.invalidate({ id: taskId! }); toast.success("Processo vinculado com sucesso!"); },
    onError: (e) => toast.error("Erro ao vincular processo: " + e.message),
  });

  const addCommentMutation = trpc.departmentTasks.addComment.useMutation({
    onSuccess: () => { utils.departmentTasks.listComments.invalidate({ taskId: taskId! }); setCommentText(""); toast.success("Comentário adicionado!"); },
    onError: (e) => toast.error("Erro ao adicionar comentário: " + e.message),
  });

  const addAttachmentMutation = trpc.departmentTasks.addAttachment.useMutation({
    onSuccess: () => { utils.departmentTasks.listAttachments.invalidate({ taskId: taskId! }); toast.success("Anexo adicionado!"); setUploadingFile(false); },
    onError: (e) => { toast.error("Erro ao adicionar anexo: " + e.message); setUploadingFile(false); },
  });

  const deleteAttachmentMutation = trpc.departmentTasks.deleteAttachment.useMutation({
    onSuccess: () => { utils.departmentTasks.listAttachments.invalidate({ taskId: taskId! }); toast.success("Anexo removido!"); },
    onError: (e) => toast.error("Erro ao remover anexo: " + e.message),
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !taskId) return;
    if (file.size > 10 * 1024 * 1024) { toast.error("Arquivo muito grande! Limite: 10MB"); return; }
    setUploadingFile(true);
    const reader = new FileReader();
    reader.onload = () => {
      addAttachmentMutation.mutate({ taskId, fileName: file.name, fileUrl: reader.result as string, fileSize: file.size, mimeType: file.type });
    };
    reader.readAsDataURL(file);
  };

  if (isLoading || !task) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
              <p className="text-muted-foreground">Carregando detalhes...</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{task.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <TaskInfoPanel task={task} />
          <Separator />
          {task.description && (
            <>
              <div>
                <h3 className="font-semibold mb-2">Descrição</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
              </div>
              <Separator />
            </>
          )}
          <TaskLinkedProcess
            taskId={task.id}
            linkedProcess={linkedProcess ?? null}
            processes={processes as any[]}
            onLink={(processId) => linkProcessMutation.mutate({ taskId: task.id, processId })}
            onUnlink={() => linkProcessMutation.mutate({ taskId: task.id, processId: null })}
          />
          <Separator />
          <TaskAttachments
            attachments={attachments}
            uploadingFile={uploadingFile}
            onFileChange={handleFileChange}
            onDelete={(id) => { if (confirm("Deseja realmente remover este anexo?")) deleteAttachmentMutation.mutate({ id }); }}
          />
          <TaskComments
            comments={comments}
            commentText={commentText}
            isPending={addCommentMutation.isPending}
            onCommentChange={setCommentText}
            onAddComment={() => { if (!commentText.trim() || !taskId) return; addCommentMutation.mutate({ taskId, content: commentText }); }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
