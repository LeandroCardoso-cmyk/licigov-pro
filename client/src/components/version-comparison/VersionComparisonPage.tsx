import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { GitCompare, ToggleLeft, ToggleRight } from "lucide-react";
import { DiffViewer } from "./DiffViewer";
import { ChangeSummaryPanel } from "./ChangeSummaryPanel";

interface VersionEntry {
  versionId: string;
  message: string;
  author: number;
  createdAt: string;
}

interface DiffChange {
  field: string;
  type: "added" | "removed" | "modified";
  before: string | null;
  after: string | null;
  similarity: number;
}

interface VersionComparisonPageProps {
  versions: VersionEntry[];
  onLoadDiff?: (fromId: string, toId: string) => Promise<DiffChange[]>;
  entityLabel?: string;
}

export function VersionComparisonPage({
  versions,
  onLoadDiff,
  entityLabel = "Documento",
}: VersionComparisonPageProps) {
  const [fromVersion, setFromVersion] = useState<string>(
    versions[0]?.versionId ?? "",
  );
  const [toVersion, setToVersion] = useState<string>(
    versions[versions.length - 1]?.versionId ?? "",
  );
  const [diffChanges, setDiffChanges] = useState<DiffChange[]>([]);
  const [mode, setMode] = useState<"inline" | "split">("split");
  const [loading, setLoading] = useState(false);

  const summary = {
    addedCount: diffChanges.filter((c) => c.type === "added").length,
    removedCount: diffChanges.filter((c) => c.type === "removed").length,
    modifiedCount: diffChanges.filter((c) => c.type === "modified").length,
    highImpactChanges: diffChanges
      .filter((c) => c.type === "modified" && c.similarity < 0.5)
      .map((c) => c.field),
  };

  async function handleCompare() {
    if (!onLoadDiff || !fromVersion || !toVersion) return;
    setLoading(true);
    try {
      const changes = await onLoadDiff(fromVersion, toVersion);
      setDiffChanges(changes);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitCompare className="w-4 h-4" />
            Comparação de versões — {entityLabel}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-36">
              <label className="text-xs text-muted-foreground mb-1 block">
                De (versão base)
              </label>
              <Select value={fromVersion} onValueChange={setFromVersion}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecionar versão" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.versionId} value={v.versionId}>
                      <span className="text-xs">
                        {v.versionId.slice(0, 8)}… — {v.message}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-36">
              <label className="text-xs text-muted-foreground mb-1 block">
                Para (versão nova)
              </label>
              <Select value={toVersion} onValueChange={setToVersion}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecionar versão" />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((v) => (
                    <SelectItem key={v.versionId} value={v.versionId}>
                      <span className="text-xs">
                        {v.versionId.slice(0, 8)}… — {v.message}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              size="sm"
              onClick={handleCompare}
              disabled={loading || !fromVersion || !toVersion}
              className="h-8"
            >
              {loading ? "Comparando..." : "Comparar"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setMode(mode === "split" ? "inline" : "split")}
            >
              {mode === "split" ? (
                <ToggleLeft className="w-4 h-4 mr-1" />
              ) : (
                <ToggleRight className="w-4 h-4 mr-1" />
              )}
              {mode === "split" ? "Dividido" : "Inline"}
            </Button>
          </div>

          {fromVersion === toVersion && (
            <Badge variant="secondary" className="mt-2 text-xs">
              Selecione versões diferentes para comparar
            </Badge>
          )}
        </CardContent>
      </Card>

      {diffChanges.length > 0 && (
        <>
          <ChangeSummaryPanel summary={summary} />
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Diferenças detalhadas</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <DiffViewer changes={diffChanges} mode={mode} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
