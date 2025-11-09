import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Send, Edit2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/_core/hooks/useAuth";

interface CommentsSectionProps {
  documentId: number;
  processId: number;
}

export function CommentsSection({ documentId, processId }: CommentsSectionProps) {
  const { user } = useAuth();
  const [newComment, setNewComment] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [deletingCommentId, setDeletingCommentId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  const { data: comments = [], isLoading } = trpc.comments.list.useQuery({ documentId });

  const addCommentMutation = trpc.comments.add.useMutation({
    onSuccess: () => {
      toast.success("Comentário adicionado!");
      setNewComment("");
      utils.comments.list.invalidate({ documentId });
    },
    onError: (error) => {
      toast.error("Erro ao adicionar comentário", { description: error.message });
    },
  });

  const updateCommentMutation = trpc.comments.update.useMutation({
    onSuccess: () => {
      toast.success("Comentário atualizado!");
      setEditingCommentId(null);
      setEditingContent("");
      utils.comments.list.invalidate({ documentId });
    },
    onError: (error) => {
      toast.error("Erro ao atualizar comentário", { description: error.message });
    },
  });

  const deleteCommentMutation = trpc.comments.delete.useMutation({
    onSuccess: () => {
      toast.success("Comentário excluído!");
      setDeletingCommentId(null);
      utils.comments.list.invalidate({ documentId });
    },
    onError: (error) => {
      toast.error("Erro ao excluir comentário", { description: error.message });
    },
  });

  const handleAddComment = () => {
    if (!newComment.trim()) {
      toast.error("Digite um comentário");
      return;
    }

    addCommentMutation.mutate({
      documentId,
      processId,
      content: newComment,
    });
  };

  const handleStartEdit = (commentId: number, content: string) => {
    setEditingCommentId(commentId);
    setEditingContent(content);
  };

  const handleCancelEdit = () => {
    setEditingCommentId(null);
    setEditingContent("");
  };

  const handleSaveEdit = () => {
    if (!editingContent.trim()) {
      toast.error("O comentário não pode estar vazio");
      return;
    }

    if (editingCommentId) {
      updateCommentMutation.mutate({
        commentId: editingCommentId,
        content: editingContent,
      });
    }
  };

  const handleDeleteComment = () => {
    if (deletingCommentId) {
      deleteCommentMutation.mutate({ commentId: deletingCommentId });
    }
  };

  return (
    <div className="border rounded-lg p-4 bg-card">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="h-5 w-5 text-muted-foreground" />
        <h3 className="font-semibold">Comentários ({comments.length})</h3>
      </div>

      {/* Novo comentário */}
      <div className="mb-4">
        <Textarea
          placeholder="Adicione um comentário..."
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          rows={3}
          className="mb-2"
        />
        <Button
          onClick={handleAddComment}
          disabled={addCommentMutation.isPending || !newComment.trim()}
          size="sm"
        >
          <Send className="mr-2 h-4 w-4" />
          {addCommentMutation.isPending ? "Enviando..." : "Enviar"}
        </Button>
      </div>

      {/* Lista de comentários */}
      <ScrollArea className="h-[400px]">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground">Carregando comentários...</div>
        ) : comments.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <MessageSquare className="mx-auto h-12 w-12 mb-2 opacity-50" />
            <p>Nenhum comentário ainda</p>
            <p className="text-sm">Seja o primeiro a comentar!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {comments.map((comment) => (
              <div key={comment.id} className="border-b pb-4 last:border-b-0">
                {editingCommentId === comment.id ? (
                  <div>
                    <Textarea
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      rows={3}
                      className="mb-2"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleSaveEdit}
                        disabled={updateCommentMutation.isPending}
                      >
                        Salvar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCancelEdit}
                        disabled={updateCommentMutation.isPending}
                      >
                        <X className="mr-2 h-4 w-4" />
                        Cancelar
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-sm font-medium text-primary">
                            {comment.userId.toString().slice(0, 2)}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium">Usuário #{comment.userId}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(comment.createdAt), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                            {comment.updatedAt !== comment.createdAt && " (editado)"}
                          </p>
                        </div>
                      </div>
                      {user?.id === comment.userId && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleStartEdit(comment.id, comment.content)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingCommentId(comment.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Dialog de confirmação de exclusão */}
      <AlertDialog
        open={deletingCommentId !== null}
        onOpenChange={() => setDeletingCommentId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Comentário</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este comentário? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteComment}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
