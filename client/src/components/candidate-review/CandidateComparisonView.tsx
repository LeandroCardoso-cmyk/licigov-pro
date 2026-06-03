import { SemanticScoreBar } from "@/components/ui/SemanticScoreBar";
import { Badge } from "@/components/ui/badge";

interface CandidateData {
  id: string;
  rank: number;
  description: string;
  catmatCode?: string;
  score: number;
  source: string;
  matchedTokens: string[];
}

interface CandidateComparisonViewProps {
  left: CandidateData;
  right: CandidateData;
}

function Column({ candidate }: { candidate: CandidateData }) {
  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">#{candidate.rank}</span>
        {candidate.catmatCode && (
          <Badge variant="secondary" className="font-mono text-xs">{candidate.catmatCode}</Badge>
        )}
      </div>
      <p className="text-sm font-medium">{candidate.description}</p>
      <SemanticScoreBar score={candidate.score} label="Score semântico" />
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Fonte:</span>
        <Badge variant="outline" className="text-xs">{candidate.source}</Badge>
      </div>
      <div className="space-y-1">
        <span className="text-xs text-muted-foreground">Tokens correspondentes:</span>
        <div className="flex flex-wrap gap-1">
          {candidate.matchedTokens.map(t => (
            <span key={t} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
              {t}
            </span>
          ))}
          {candidate.matchedTokens.length === 0 && (
            <span className="text-xs text-muted-foreground italic">Nenhum</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function CandidateComparisonView({ left, right }: CandidateComparisonViewProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <Column candidate={left} />
      <Column candidate={right} />
    </div>
  );
}
