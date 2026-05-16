import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Send } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Comment {
  id: number;
  userId: number | string;
  content: string;
  createdAt: Date | string;
}

interface Props {
  comments: Comment[];
  commentText: string;
  isPending: boolean;
  onCommentChange: (v: string) => void;
  onAddComment: () => void;
}

export function TaskComments({ comments, commentText, isPending, onCommentChange, onAddComment }: Props) {
  return (
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
                {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true, locale: ptBR })}
              </span>
            </div>
            <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
          </div>
        ))}

        {comments.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum comentário ainda</p>
        )}

        <div className="space-y-2 pt-4">
          <Textarea
            placeholder="Adicione um comentário..."
            value={commentText}
            onChange={(e) => onCommentChange(e.target.value)}
            rows={3}
          />
          <Button onClick={onAddComment} disabled={!commentText.trim() || isPending} size="sm">
            <Send className="h-4 w-4 mr-2" />
            {isPending ? "Enviando..." : "Enviar Comentário"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
