import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Trash2, User } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface CommentAuthor {
  userId: number;
  name: string;
  role: string;
}

interface CollaborationComment {
  id: string;
  content: string;
  author: CommentAuthor;
  mentions: number[];
  status: "active" | "resolved" | "deleted";
  editHistory: { content: string; editedAt: string }[];
  createdAt: string;
  updatedAt: string;
}

interface CommentCardProps {
  comment: CollaborationComment;
  onResolve?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  currentUserId?: number;
}

function renderContentWithMentions(content: string): React.ReactNode {
  const parts = content.split(/(@\d+)/g);
  return parts.map((part, i) => {
    if (/^@\d+$/.test(part)) {
      return (
        <Badge key={i} variant="secondary" className="mx-0.5 text-xs">
          {part}
        </Badge>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function CommentCard({
  comment,
  onResolve,
  onDelete,
  currentUserId,
}: CommentCardProps) {
  if (comment.status === "deleted") {
    return (
      <div className="py-2 px-3 text-sm text-muted-foreground italic border border-dashed rounded-md">
        Comentário removido
      </div>
    );
  }

  const isEdited = comment.editHistory.length > 0;
  const isAuthor = currentUserId === comment.author.userId;

  return (
    <Card
      className={`mb-2 ${comment.status === "resolved" ? "opacity-60" : ""}`}
    >
      <CardContent className="pt-3 pb-2 px-3">
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-medium text-sm">{comment.author.name}</span>
              <Badge variant="outline" className="text-xs py-0">
                {comment.author.role}
              </Badge>
              {comment.status === "resolved" && (
                <Badge variant="secondary" className="text-xs py-0">
                  Resolvido
                </Badge>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {format(new Date(comment.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                {isEdited && " (editado)"}
              </span>
            </div>
            <div className="text-sm text-foreground">
              {renderContentWithMentions(comment.content)}
            </div>
            {isAuthor && comment.status === "active" && (
              <div className="flex gap-1 mt-2">
                {onResolve && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => onResolve(comment.id)}
                  >
                    <CheckCircle2 className="w-3 h-3 mr-1" />
                    Resolver
                  </Button>
                )}
                {onDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs text-destructive"
                    onClick={() => onDelete(comment.id)}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Remover
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
