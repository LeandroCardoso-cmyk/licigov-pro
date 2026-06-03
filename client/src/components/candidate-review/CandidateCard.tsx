import { Badge } from "@/components/ui/badge";
import { SemanticScoreBar } from "@/components/ui/SemanticScoreBar";

interface CandidateCardProps {
  catmatCode?: string;
  description: string;
  score: number;
  source: string;
  matchedTokens: string[];
  rank: number;
  isSelected?: boolean;
  onClick?: () => void;
}

const sourceLabels: Record<string, string> = {
  exact_match:   "Exato",
  alias_match:   "Alias",
  fuzzy_match:   "Fuzzy",
  prefix_match:  "Prefixo",
  token_match:   "Tokens",
  ngram_match:   "N-gram",
  rule_based:    "Regra",
  catmat_lookup: "CATMAT",
};

export function CandidateCard({
  catmatCode,
  description,
  score,
  source,
  matchedTokens,
  rank,
  isSelected = false,
  onClick,
}: CandidateCardProps) {
  return (
    <div
      className={`border rounded-lg p-3 space-y-2 transition-colors ${isSelected ? "border-primary bg-primary/5" : ""} ${onClick ? "cursor-pointer hover:bg-muted/30" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? e => { if (e.key === "Enter") onClick(); } : undefined}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground font-mono">#{rank}</span>
        {catmatCode && (
          <Badge variant="secondary" className="font-mono text-xs">{catmatCode}</Badge>
        )}
        <Badge variant="outline" className="text-xs">
          {sourceLabels[source] ?? source}
        </Badge>
      </div>
      <p className="text-sm font-medium line-clamp-2">{description}</p>
      <SemanticScoreBar score={score} label="Score" />
      {matchedTokens.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {matchedTokens.slice(0, 5).map(token => (
            <span key={token} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
              {token}
            </span>
          ))}
          {matchedTokens.length > 5 && (
            <span className="text-xs text-muted-foreground">+{matchedTokens.length - 5}</span>
          )}
        </div>
      )}
    </div>
  );
}
