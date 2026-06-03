import { Badge } from "@/components/ui/badge";

interface DiffChange {
  field: string;
  type: "added" | "removed" | "modified";
  before: string | null;
  after: string | null;
  similarity: number;
}

interface DiffViewerProps {
  changes: DiffChange[];
  mode?: "inline" | "split";
}

function getSimilarityColor(similarity: number): string {
  if (similarity > 0.8) return "text-yellow-600";
  if (similarity > 0.5) return "text-orange-500";
  return "text-red-600";
}

function DiffLine({
  type,
  content,
  label,
}: {
  type: "added" | "removed" | "unchanged";
  content: string;
  label?: string;
}) {
  const bg =
    type === "added"
      ? "bg-green-50 border-l-4 border-green-400"
      : type === "removed"
        ? "bg-red-50 border-l-4 border-red-400"
        : "bg-gray-50 border-l-4 border-transparent";

  const textColor =
    type === "added"
      ? "text-green-800"
      : type === "removed"
        ? "text-red-800"
        : "text-gray-600";

  const prefix =
    type === "added" ? "+" : type === "removed" ? "-" : " ";

  return (
    <div className={`flex gap-2 px-3 py-1 text-xs font-mono ${bg}`}>
      <span className={`font-bold w-4 flex-shrink-0 ${textColor}`}>
        {prefix}
      </span>
      <span className={textColor}>
        {label && (
          <span className="font-bold mr-1 opacity-60">[{label}]</span>
        )}
        {content}
      </span>
    </div>
  );
}

export function DiffViewer({ changes, mode = "split" }: DiffViewerProps) {
  if (changes.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        Sem alterações detectadas.
      </div>
    );
  }

  if (mode === "inline") {
    return (
      <div className="space-y-2">
        {changes.map((change, i) => (
          <div key={i} className="rounded overflow-hidden border">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted text-xs font-medium">
              <span>{change.field}</span>
              <Badge
                variant={
                  change.type === "added"
                    ? "default"
                    : change.type === "removed"
                      ? "destructive"
                      : "secondary"
                }
                className="text-xs"
              >
                {change.type === "added"
                  ? "Adicionado"
                  : change.type === "removed"
                    ? "Removido"
                    : "Modificado"}
              </Badge>
              {change.type === "modified" && (
                <span
                  className={`text-xs ml-auto ${getSimilarityColor(change.similarity)}`}
                >
                  {Math.round(change.similarity * 100)}% similar
                </span>
              )}
            </div>
            {change.before !== null && (
              <DiffLine type="removed" content={change.before} />
            )}
            {change.after !== null && (
              <DiffLine type="added" content={change.after} />
            )}
          </div>
        ))}
      </div>
    );
  }

  // Split mode
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground px-1 mb-1">
          Antes
        </div>
        {changes.map((change, i) => (
          <div key={i} className="rounded overflow-hidden border">
            <div className="px-3 py-1 bg-muted text-xs font-medium">
              {change.field}
            </div>
            {change.before !== null ? (
              <DiffLine
                type={change.type === "modified" ? "removed" : change.type === "removed" ? "removed" : "unchanged"}
                content={change.before}
              />
            ) : (
              <div className="px-3 py-1 text-xs text-muted-foreground italic">
                (vazio)
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground px-1 mb-1">
          Depois
        </div>
        {changes.map((change, i) => (
          <div key={i} className="rounded overflow-hidden border">
            <div className="px-3 py-1 bg-muted text-xs font-medium">
              {change.field}
            </div>
            {change.after !== null ? (
              <DiffLine
                type={change.type === "modified" ? "added" : change.type === "added" ? "added" : "unchanged"}
                content={change.after}
              />
            ) : (
              <div className="px-3 py-1 text-xs text-muted-foreground italic">
                (vazio)
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
