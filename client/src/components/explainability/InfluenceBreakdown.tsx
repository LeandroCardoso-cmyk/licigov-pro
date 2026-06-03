interface InfluenceFactor {
  label: string;
  score: number;
  bgColor: string;
}

interface InfluenceBreakdownProps {
  lexicalScore?:       number;
  semanticScore?:      number;
  normalizationScore?: number;
  parserScore?:        number;
}

export function InfluenceBreakdown({
  lexicalScore       = 0.30,
  semanticScore      = 0.35,
  normalizationScore = 0.20,
  parserScore        = 0.15,
}: InfluenceBreakdownProps) {
  const factors: InfluenceFactor[] = [
    { label: "Léxico (30%)",       score: lexicalScore,       bgColor: "#3b82f6" },
    { label: "Semântico (35%)",    score: semanticScore,      bgColor: "#a855f7" },
    { label: "Normalização (20%)", score: normalizationScore, bgColor: "#f97316" },
    { label: "Parser (15%)",       score: parserScore,        bgColor: "#22c55e" },
  ];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Influência por Componente</h3>
      {factors.map(f => (
        <div key={f.label} className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{f.label}</span>
            <span>{Math.round(f.score * 100)}%</span>
          </div>
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(1, f.score) * 100}%`, backgroundColor: f.bgColor }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
