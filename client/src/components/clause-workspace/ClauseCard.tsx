import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LegalReferenceTag } from "./LegalReferenceTag";
import { ClauseOverrideModal } from "./ClauseOverrideModal";
import { Eye, Edit } from "lucide-react";

interface ClauseCardProps {
  id:             string;
  title:          string;
  content:        string;
  legalBasis:     string | null;
  relevanceScore: number;
  isOverride:     boolean;
  source:         string;
  onOverride:     (clauseId: string, newContent: string, justification: string) => void;
  onView?:        (clauseId: string) => void;
  isOverriding?:  boolean;
}

export function ClauseCard({
  id,
  title,
  content,
  legalBasis,
  relevanceScore,
  isOverride,
  source,
  onOverride,
  onView,
  isOverriding = false,
}: ClauseCardProps) {
  const [overrideOpen, setOverrideOpen] = useState(false);

  const truncated = content.length > 160 ? content.slice(0, 160) + "…" : content;
  const pct       = Math.round(relevanceScore * 100);

  return (
    <>
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold">{title}</h3>
              {isOverride && <Badge variant="outline" className="text-xs border-yellow-300 text-yellow-700 bg-yellow-50">Override</Badge>}
              <Badge variant="secondary" className="text-xs">{pct}%</Badge>
            </div>
            {legalBasis && <LegalReferenceTag reference={legalBasis} />}
          </div>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed">{truncated}</p>

        <div className="flex items-center gap-2">
          {onView && (
            <Button size="sm" variant="ghost" className="gap-1 text-xs" onClick={() => onView(id)}>
              <Eye className="h-3 w-3" />
              Ver
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 text-xs border border-yellow-300 text-yellow-700 hover:bg-yellow-50"
            onClick={() => setOverrideOpen(true)}
            disabled={isOverriding}
          >
            <Edit className="h-3 w-3" />
            Override
          </Button>
        </div>
      </div>

      <ClauseOverrideModal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        clauseTitle={title}
        currentContent={content}
        onConfirm={(newContent, justification) => {
          onOverride(id, newContent, justification);
          setOverrideOpen(false);
        }}
        isLoading={isOverriding}
      />
    </>
  );
}
