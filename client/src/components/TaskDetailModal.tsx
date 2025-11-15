import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  MessageSquare,
  Paperclip,
  Send,
  Upload,
  Download,
  Trash2,
  Calendar,
  User,
  Clock,
  AlertCircle,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

interface TaskDetailModalProps {
  taskId: number | null;
  open: boolean;
  onClose: () => void;
}

const PRIORITY_COLORS = {
  baixa: "bg-slate-100 text-slate-700 border-slate-300",
  media: "bg-blue-100 text-blue-700 border-blue-300",
  alta: "bg-orange-100 text-orange-700 border-orange-300",
  urgente: "bg-red-100 text-red-700 border-red-300",
};

const PRIORITY_LABELS = {
  baixa: "Baixa",
  media: "Média",
  alta: "Alta",
  urgente: "Urgente",
};

const STATUS_COLORS = {
  pendente: "bg-slate-100 text-slate-700",
  em_andamento: "bg-blue-100 text-blue-700",
  pausada: "bg-yellow-100 text-yellow-700",
  atrasada: "bg-red-100 text-red-700",
  aguardando_informacao: "bg-purple-100 text-purple-700",
  concluida: "bg-green-100 text-green-700",
  cancelada: "bg-gray-100 text-gray-700",
};

const STATUS_LABELS = {
  pendente: "Pendente",
  em_andamento: "Em Andamento",
  pausada: "Pausada",
  atrasada: "Atrasada",
  aguardando_informacao: "Aguardando Info",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export default function TaskDetailModal({ taskId, open, onClose }: TaskDetailModalProps) {
  const [commentText, setCommentText] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);

  const utils = trpc.useUtils();

  // Query para buscar detalhes da tarefa
  const { data: task, isLoading } = trpc.departmentTasks.getById.useQuery(
    { id: taskId! },
    { enabled: !!taskId }
  );

  // Query para buscar comentários
  const { data: comments = [] } = trpc.departmentTasks.listComments.useQuery(
    { taskId: taskId! },
    { enabled: !!taskId }
  );

  // Query para buscar anexos
  const { data: attachments = [] } = trpc.departmentTasks.listAttachments.useQuery(
    { taskId: taskId! },
    { enabled: !!taskId }
  );

  // Query para listar processos do usuário
  const { data: processes = [] } = trpc.departmentTasks.listProcesses.useQuery();

  // Query para buscar processo vinculado
  const { data: linkedProcess } = trpc.departmentTasks.getProcess.useQuery(
    { id: task?.processId! },
    { enabled: !!task?.processId }
  );

  // Mutation para vincular/desvincular processo
  const linkProcessMutation = trpc.departmentTasks.linkProcess.useMutation({
    onSuccess: () => {
      utils.departmentTasks.getById.invalidate({ id: taskId! });
      toast.success("Processo vinculado com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao vincular processo: " + error.message);
    },
  });

  // Mutation para adicionar comentário
  const addCommentMutation = trpc.departmentTasks.addComment.useMutation({
    onSuccess: () => {
      utils.departmentTasks.listComments.invalidate({ taskId: taskId! });
      setCommentText("");
      toast.success("Comentário adicionado!");
    },
    onError: (error) => {
      toast.error("Erro ao adicionar comentário: " + error.message);
    },
  });

  // Mutation para adicionar anexo
  const addAttachmentMutation = trpc.departmentTasks.addAttachment.useMutation({
    onSuccess: () => {
      utils.departmentTasks.listAttachments.invalidate({ taskId: taskId! });
      toast.success("Anexo adicionado!");
      setUploadingFile(false);
    },
    onError: (error) => {
      toast.error("Erro ao adicionar anexo: " + error.message);
      setUploadingFile(false);
    },
  });

  // Mutation para deletar anexo
  const deleteAttachmentMutation = trpc.departmentTasks.deleteAttachment.useMutation({
    onSuccess: () => {
      utils.departmentTasks.listAttachments.invalidate({ taskId: taskId! });
      toast.success("Anexo removido!");
    },
    onError: (error) => {
      toast.error("Erro ao remover anexo: " + error.message);
    },
  });

  const handleAddComment = () => {
    if (!commentText.trim() || !taskId) return;

    addCommentMutation.mutate({
      taskId,
      content: commentText,
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !taskId) return;

    // Validar tamanho (10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande! Limite: 10MB");
      return;
    }

    setUploadingFile(true);

    // Converter para base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      
      addAttachmentMutation.mutate({
        taskId,
        fileName: file.name,
        fileUrl: base64, // Em produção, fazer upload para S3 primeiro
        fileSize: file.size,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteAttachment = (attachmentId: number) => {
    if (!confirm("Deseja realmente remover este anexo?")) return;
    deleteAttachmentMutation.mutate({ id: attachmentId });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  if (isLoading || !task) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
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
          {/* Informações principais */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Prioridade:</span>
                <Badge className={PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS]}>
                  {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
                </Badge>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Status:</span>
                <Badge className={STATUS_COLORS[task.status as keyof typeof STATUS_COLORS]}>
                  {STATUS_LABELS[task.status as keyof typeof STATUS_LABELS]}
                </Badge>
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
                  ) : (
                    "Sem prazo definido"
                  )}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Responsável:</span>
                <span>{task.assignedTo || "Não atribuído"}</span>
              </div>
            </div>
          </div>

          <Separator />

          {/* Descrição */}
          {task.description && (
            <div>
              <h3 className="font-semibold mb-2">Descrição</h3>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          <Separator />

          {/* Processo Vinculado */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Processo Licitató rio
              </CardTitle>
            </CardHeader>
            <CardContent>
              {linkedProcess ? (
                <div className="space-y-2">
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="font-medium">{linkedProcess.name}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {linkedProcess.description || "Sem descrição"}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="outline">{linkedProcess.modality || "Modalidade não definida"}</Badge>
                      <Badge variant="outline">{linkedProcess.status}</Badge>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => linkProcessMutation.mutate({ taskId: task.id, processId: null })}
                  >
                    Desvincular Processo
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Nenhum processo vinculado</p>
                  {processes.length > 0 && (
                    <select
                      className="w-full p-2 border rounded-md"
                      onChange={(e) => {
                        const processId = parseInt(e.target.value);
                        if (processId) {
                          linkProcessMutation.mutate({ taskId: task.id, processId });
                        }
                      }}
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Selecione um processo...
                      </option>
                      {processes.map((process: any) => (
                        <option key={process.id} value={process.id}>
                          {process.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Separator />

          {/* Anexos */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Paperclip className="h-4 w-4" />
                Anexos ({attachments.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {attachments.map((attachment) => (
                <div
                  key={attachment.id}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{attachment.fileName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(attachment.fileSize)}
                        {attachment.uploadedAt && (
                          <>
                            {" • "}
                            {formatDistanceToNow(new Date(attachment.uploadedAt), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a href={attachment.fileUrl} download={attachment.fileName}>
                      <Button size="sm" variant="ghost">
                        <Download className="h-4 w-4" />
                      </Button>
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteAttachment(attachment.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              <div className="pt-2">
                <label htmlFor="file-upload">
                  <Button variant="outline" size="sm" disabled={uploadingFile} onClick={() => document.getElementById('file-upload')?.click()}>
                    <span className="cursor-pointer">
                      <Upload className="h-4 w-4 mr-2" />
                      {uploadingFile ? "Enviando..." : "Adicionar Anexo"}
                    </span>
                  </Button>
                  <input
                    id="file-upload"
                    type="file"
                    className="hidden"
                    onChange={handleFileUpload}
                    disabled={uploadingFile}
                  />
                </label>
                <p className="text-xs text-muted-foreground mt-1">Limite: 10MB</p>
              </div>
            </CardContent>
          </Card>

          {/* Comentários */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Comentários ({comments.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="border-l-2 border-primary pl-4 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-sm">{comment.userId}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(comment.createdAt), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                </div>
              ))}

              {comments.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum comentário ainda
                </p>
              )}

              <div className="space-y-2 pt-4">
                <Textarea
                  placeholder="Adicione um comentário..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  rows={3}
                />
                <Button
                  onClick={handleAddComment}
                  disabled={!commentText.trim() || addCommentMutation.isPending}
                  size="sm"
                >
                  <Send className="h-4 w-4 mr-2" />
                  {addCommentMutation.isPending ? "Enviando..." : "Enviar Comentário"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
