import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { ClauseRecommendationList } from "./ClauseRecommendationList";
import { Loader2, Scale } from "lucide-react";

interface ClauseWorkspacePageProps {
  itemId:         string;
  organizationId: number;
  actorUserId:    number;
}

export function ClauseWorkspacePage({
  itemId,
  organizationId,
  actorUserId,
}: ClauseWorkspacePageProps) {
  const [viewingClause, setViewingClause] = useState<string | null>(null);

  const recommendationsQuery = trpc.clauses.getRecommendations.useQuery(
    { itemId, organizationId },
    { enabled: !!itemId && organizationId > 0 },
  );

  const overrideMut = trpc.clauses.overrideClause.useMutation({
    onSuccess: () => {
      toast.success("Cláusula sobrescrita com sucesso");
      void recommendationsQuery.refetch();
    },
    onError: err => toast.error(err.message),
  });

  function handleOverride(clauseId: string, newContent: string, justification: string) {
    overrideMut.mutate({
      itemId,
      clauseId,
      organizationId,
      actorUserId,
      justification,
      newContent,
    });
  }

  const viewingRec = viewingClause
    ? recommendationsQuery.data?.find(r => r.id === viewingClause) ?? null
    : null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <Scale className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Workspace de Cláusulas</h2>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5">
          Cláusulas recomendadas para o item selecionado (Lei 14.133/2021)
        </p>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left: recommendations list */}
        <div className="w-1/2 border-r overflow-y-auto p-4">
          <h3 className="text-sm font-medium mb-3">
            Cláusulas Recomendadas ({recommendationsQuery.data?.length ?? 0})
          </h3>
          <ClauseRecommendationList
            recommendations={recommendationsQuery.data ?? []}
            isLoading={recommendationsQuery.isLoading}
            onOverride={handleOverride}
            onView={id => setViewingClause(id === viewingClause ? null : id)}
            isOverriding={overrideMut.isPending}
          />
        </div>

        {/* Right: viewer */}
        <div className="flex-1 overflow-y-auto p-4">
          {viewingRec ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold">{viewingRec.title}</h3>
                {viewingRec.legalBasis && (
                  <p className="text-xs text-blue-600 mt-1">{viewingRec.legalBasis}</p>
                )}
              </div>
              <div className="prose prose-sm max-w-none border rounded-lg p-4 bg-muted/30">
                <p className="whitespace-pre-wrap text-sm">{viewingRec.content}</p>
              </div>
              <p className="text-xs text-muted-foreground">{viewingRec.rationale}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <Scale className="h-10 w-10 opacity-30" />
              <p className="text-sm">Selecione uma cláusula para visualizar o conteúdo completo</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
