import { ClauseCard } from "./ClauseCard";
import { Loader2 } from "lucide-react";

interface ClauseRecommendation {
  id:             string;
  templateId:     string;
  title:          string;
  content:        string;
  legalBasis:     string | null;
  priority:       number;
  relevanceScore: number;
  isOverride:     boolean;
  source:         string;
}

interface ClauseRecommendationListProps {
  recommendations: ClauseRecommendation[];
  isLoading?:      boolean;
  onOverride:      (clauseId: string, newContent: string, justification: string) => void;
  onView?:         (clauseId: string) => void;
  isOverriding?:   boolean;
}

export function ClauseRecommendationList({
  recommendations,
  isLoading = false,
  onOverride,
  onView,
  isOverriding = false,
}: ClauseRecommendationListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Nenhuma cláusula recomendada para este item/processo.
      </div>
    );
  }

  // Sort by priority DESC then relevanceScore DESC
  const sorted = [...recommendations].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return b.relevanceScore - a.relevanceScore;
  });

  return (
    <div className="space-y-3">
      {sorted.map(rec => (
        <ClauseCard
          key={rec.id}
          id={rec.id}
          title={rec.title}
          content={rec.content}
          legalBasis={rec.legalBasis}
          relevanceScore={rec.relevanceScore}
          isOverride={rec.isOverride}
          source={rec.source}
          onOverride={onOverride}
          onView={onView}
          isOverriding={isOverriding}
        />
      ))}
    </div>
  );
}
