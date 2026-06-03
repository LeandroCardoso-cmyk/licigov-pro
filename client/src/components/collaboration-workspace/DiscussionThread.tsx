import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, MessageSquare, ChevronDown, ChevronUp } from "lucide-react";
import { CommentCard } from "./CommentCard";
import { CommentComposer } from "./CommentComposer";

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

interface Thread {
  id: string;
  title: string;
  comments: CollaborationComment[];
  status: "open" | "resolved";
  resolvedBy: number | null;
  resolvedAt: string | null;
  createdAt: string;
}

interface DiscussionThreadProps {
  thread: Thread;
  currentUserId?: number;
  onAddComment?: (threadId: string, content: string) => void;
  onResolveThread?: (threadId: string) => void;
}

export function DiscussionThread({
  thread,
  currentUserId,
  onAddComment,
  onResolveThread,
}: DiscussionThreadProps) {
  const [expanded, setExpanded] = useState(true);

  const visibleComments = thread.comments.filter(
    (c) => c.status !== "deleted",
  );
  const activeCount = visibleComments.filter((c) => c.status === "active").length;

  return (
    <Card className={`mb-3 ${thread.status === "resolved" ? "border-green-200" : ""}`}>
      <CardHeader className="py-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <CardTitle className="text-sm font-medium truncate">
              {thread.title}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {thread.status === "resolved" ? (
              <Badge variant="secondary" className="text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Resolvido
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                {activeCount} ativo{activeCount !== 1 ? "s" : ""}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="px-4 pb-3 space-y-2">
          {visibleComments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
            />
          ))}

          {thread.status === "open" && onAddComment && (
            <div className="mt-3 pt-3 border-t">
              <CommentComposer
                onSubmit={(content) => onAddComment(thread.id, content)}
                placeholder="Responder nesta thread..."
              />
            </div>
          )}

          {thread.status === "open" && onResolveThread && (
            <div className="flex justify-end pt-1">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => onResolveThread(thread.id)}
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Resolver thread
              </Button>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
