import { SemanticScoreBar } from "@/components/ui/SemanticScoreBar";
import { Badge } from "@/components/ui/badge";

interface RankingItem {
  id: string;
  rank: number;
  description: string;
  catmatCode?: string;
  score: number;
  source: string;
}

interface RankingVisualizationProps {
  candidates: RankingItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function RankingVisualization({ candidates, selectedId, onSelect }: RankingVisualizationProps) {
  const sorted = [...candidates].sort((a, b) => a.rank - b.rank);

  return (
    <div className="space-y-2">
      {sorted.map((c, idx) => (
        <div
          key={c.id}
          className={`flex items-center gap-3 p-2 rounded-lg border transition-colors ${c.id === selectedId ? "border-primary bg-primary/5" : "hover:bg-muted/30"} ${onSelect ? "cursor-pointer" : ""}`}
          onClick={() => onSelect?.(c.id)}
          role={onSelect ? "button" : undefined}
          tabIndex={onSelect ? 0 : undefined}
          onKeyDown={onSelect ? e => { if (e.key === "Enter") onSelect(c.id); } : undefined}
        >
          <span className="text-lg w-6 shrink-0">{MEDALS[idx] ?? `#${c.rank}`}</span>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              {c.catmatCode && (
                <Badge variant="secondary" className="text-xs font-mono">{c.catmatCode}</Badge>
              )}
              <span className="text-sm font-medium line-clamp-1">{c.description}</span>
            </div>
            <SemanticScoreBar score={c.score} label="" showValue />
          </div>
        </div>
      ))}
      {sorted.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">Nenhum candidato</p>
      )}
    </div>
  );
}
