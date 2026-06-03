interface TokenEvidenceViewProps {
  tokens: string[];
  highlightTokens?: string[];
}

export function TokenEvidenceView({ tokens, highlightTokens = [] }: TokenEvidenceViewProps) {
  const highlightSet = new Set(highlightTokens.map(t => t.toLowerCase()));

  if (tokens.length === 0) {
    return <p className="text-sm text-muted-foreground italic">Nenhum token encontrado</p>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Tokens Encontrados</h3>
      <div className="flex flex-wrap gap-1.5">
        {tokens.map((token, idx) => {
          const isHighlighted = highlightSet.has(token.toLowerCase());
          return (
            <span
              key={`${token}-${idx}`}
              className={`text-xs px-2 py-1 rounded border font-mono ${
                isHighlighted
                  ? "bg-blue-50 text-blue-800 border-blue-300 font-semibold"
                  : "bg-muted text-muted-foreground border-muted-foreground/20"
              }`}
            >
              {token}
            </span>
          );
        })}
      </div>
    </div>
  );
}
