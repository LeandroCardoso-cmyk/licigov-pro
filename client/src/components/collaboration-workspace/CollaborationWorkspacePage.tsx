import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquare, Search, Plus } from "lucide-react";
import { DiscussionThread } from "./DiscussionThread";
import { CommentComposer } from "./CommentComposer";
import { CollaborationTimeline } from "./CollaborationTimeline";
import { useDiscussionThreads, useCreateComment, useResolveThread } from "@/hooks/useCollaboration";

interface CollaborationWorkspacePageProps {
  entityId: string;
  entityType: "item_tr" | "clause" | "document" | "workflow";
  organizationId: number;
  currentUserId: number;
}

export function CollaborationWorkspacePage({
  entityId,
  entityType,
  organizationId,
  currentUserId,
}: CollaborationWorkspacePageProps) {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"threads" | "timeline">("threads");

  const { data: threads = [], isLoading } = useDiscussionThreads(
    entityId,
    entityType,
    organizationId,
  );

  const createComment = useCreateComment();
  const resolveThread = useResolveThread();

  const filtered = threads.filter(
    (t) =>
      search === "" ||
      t.title.toLowerCase().includes(search.toLowerCase()),
  );

  const openCount = threads.filter((t) => t.status === "open").length;

  function handleNewRootComment(content: string) {
    createComment.mutate({
      entityId,
      entityType,
      organizationId,
      content,
      threadId: null,
      actorUserId: currentUserId,
    });
  }

  function handleAddReply(threadId: string, content: string) {
    createComment.mutate({
      entityId,
      entityType,
      organizationId,
      content,
      threadId,
      actorUserId: currentUserId,
    });
  }

  function handleResolveThread(threadId: string) {
    resolveThread.mutate({
      threadId,
      organizationId,
      actorUserId: currentUserId,
    });
  }

  // Build timeline events from threads
  const timelineEvents = threads
    .flatMap((t) =>
      t.comments
        .filter((c) => c.status !== "deleted")
        .map((c) => ({
          id: c.id,
          type: "comment" as const,
          actor: c.author.name,
          content: c.content,
          createdAt: c.createdAt,
        })),
    )
    .sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  return (
    <div className="flex gap-4 h-full">
      {/* Sidebar: thread list */}
      <div className="w-72 flex-shrink-0 space-y-3">
        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Discussões</CardTitle>
              <Badge variant="outline" className="text-xs">
                {openCount} aberta{openCount !== 1 ? "s" : ""}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent truncate"
                >
                  <span
                    className={
                      t.status === "resolved"
                        ? "text-muted-foreground line-through"
                        : ""
                    }
                  >
                    {t.title}
                  </span>
                </button>
              ))}
              {isLoading && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  Carregando...
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-1">
          <Button
            variant={activeTab === "threads" ? "default" : "outline"}
            size="sm"
            className="flex-1 text-xs"
            onClick={() => setActiveTab("threads")}
          >
            <MessageSquare className="w-3 h-3 mr-1" />
            Threads
          </Button>
          <Button
            variant={activeTab === "timeline" ? "default" : "outline"}
            size="sm"
            className="flex-1 text-xs"
            onClick={() => setActiveTab("timeline")}
          >
            Timeline
          </Button>
        </div>
      </div>

      {/* Main: thread discussion or timeline */}
      <div className="flex-1 space-y-4">
        {activeTab === "threads" ? (
          <>
            <Card>
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Nova discussão
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <CommentComposer
                  onSubmit={handleNewRootComment}
                  disabled={createComment.isPending}
                  placeholder="Inicie uma nova discussão sobre este item..."
                />
              </CardContent>
            </Card>

            {threads.map((thread) => (
              <DiscussionThread
                key={thread.id}
                thread={thread}
                currentUserId={currentUserId}
                onAddComment={handleAddReply}
                onResolveThread={handleResolveThread}
              />
            ))}

            {threads.length === 0 && !isLoading && (
              <div className="text-center py-12 text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-20" />
                <p className="text-sm">Nenhuma discussão iniciada ainda.</p>
              </div>
            )}
          </>
        ) : (
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Timeline colaborativa</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <CollaborationTimeline events={timelineEvents} />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
