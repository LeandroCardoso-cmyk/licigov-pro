interface ConfidenceDataPoint {
  label:         string;
  avgConfidence: number;
}

interface ConfidenceDriftChartProps {
  data:   ConfidenceDataPoint[];
  height?: number;
}

export function ConfidenceDriftChart({ data, height = 120 }: ConfidenceDriftChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center border rounded-lg" style={{ height }}>
        <p className="text-sm text-muted-foreground">Sem dados de drift</p>
      </div>
    );
  }

  const maxVal = Math.max(...data.map(d => d.avgConfidence), 1);
  const width  = 100; // percent per step base
  const pts    = data.map((d, i) => ({
    x:     (i / (data.length - 1 || 1)) * 100,
    y:     100 - (d.avgConfidence / maxVal) * 80,
    label: d.label,
    value: d.avgConfidence,
  }));

  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <div className="border rounded-lg p-4 space-y-2">
      <h3 className="text-sm font-medium">Drift de Confiança Semântica</h3>
      <div style={{ height }} className="relative">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          {/* Grid lines */}
          {[25, 50, 75].map(y => (
            <line
              key={y}
              x1="0" y1={y} x2="100" y2={y}
              stroke="currentColor"
              strokeWidth="0.5"
              strokeDasharray="2,2"
              className="text-muted-foreground/30"
            />
          ))}
          {/* Line chart */}
          <path
            d={pathD}
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Dots */}
          {pts.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="1.5"
              fill="#3b82f6"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      {/* Labels */}
      <div className="flex justify-between text-xs text-muted-foreground">
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}
