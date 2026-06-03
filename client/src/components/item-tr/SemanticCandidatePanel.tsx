import { Button } from "@/components/ui/button";
import { SemanticScoreBar } from "@/components/ui/SemanticScoreBar";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Loader2 } from "lucide-react";

export interface SemanticCandidateItem {
  id: string;
  proposedDescription: string;
  catmatCode?: string;
  catmatDesc?: string;
  score: number;
  rank: number;
  source: string;
  status: string;
  explanation: {
    reason: string;
    matchedOn: string[];
  };
}

interface SemanticCandidatePanelProps {
  candidates: SemanticCandidateItem[];
  selectedCandidateId?: string | null;
  onSelectCandidate: (candidateId: string) => void;
  isSelecting?: boolean;
  isLoading?: boolean;
}

const sourceLabels: Record<string, string> = {
  exact_match:   "Match Exato",
  alias_match:   "Alias",
  fuzzy_match:   "Fuzzy",
  prefix_match:  "Prefixo",
  token_match:   "Tokens",
  ngram_match:   "N-gram",
  rule_based:    "Regra",
  catmat_lookup: "CATMAT",
};

export function SemanticCandidatePanel({
  candidates,
  selectedCandidateId,
  onSelectCandidate,
  isSelecting = false,
  isLoading = false,
}: SemanticCandidatePanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Nenhum candidato semântico disponível para este item.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {candidates.map((cand, idx) => {
        const isSelected = cand.id === selectedCandidateId;
        return (
          <div
            key={cand.id}
            className={`border rounded-lg p-3 space-y-2 transition-colors ${isSelected ? "border-primary bg-primary/5" : "hover:bg-muted/30"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-muted-foreground">#{idx + 1}</span>
                  <Badge variant="outline" className="text-xs">
                    {sourceLabels[cand.source] ?? cand.source}
                  </Badge>
                  {cand.catmatCode && (
                    <Badge variant="secondary" className="text-xs font-mono">
                      {cand.catmatCode}
                    </Badge>
                  )}
                  {isSelected && (
                    <CheckCircle className="h-3.5 w-3.5 text-primary" />
                  )}
                </div>
                <p className="text-sm font-medium line-clamp-2">{cand.proposedDescription}</p>
                {cand.catmatDesc && (
                  <p className="text-xs text-muted-foreground mt-0.5">{cand.catmatDesc}</p>
                )}
              </div>
            </div>

            <SemanticScoreBar score={cand.score} label="Score semântico" />

            {cand.explanation.matchedOn.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {cand.explanation.matchedOn.map(token => (
                  <span key={token} className="text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">
                    {token}
                  </span>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">{cand.explanation.reason}</p>

            <Button
              size="sm"
              variant={isSelected ? "default" : "outline"}
              className="w-full"
              onClick={() => onSelectCandidate(cand.id)}
              disabled={isSelecting || isSelected}
            >
              {isSelecting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              {isSelected ? "Selecionado" : "Selecionar"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
