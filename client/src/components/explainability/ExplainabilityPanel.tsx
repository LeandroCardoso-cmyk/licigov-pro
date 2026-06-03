import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { InfluenceBreakdown } from "./InfluenceBreakdown";
import { TokenEvidenceView } from "./TokenEvidenceView";
import { ProvenanceViewer } from "./ProvenanceViewer";
import { SemanticTraceView, type SemanticStep } from "./SemanticTraceView";

interface ExplainabilityPanelProps {
  whySuggested?:     string;
  whyRanked?:        string;
  influencingTokens?: string[];
  highlightTokens?:   string[];
  aliasesUsed?:       string[];
  lexicalScore?:      number;
  semanticScore?:     number;
  normalizationScore?: number;
  parserScore?:       number;
  provenance?: {
    sourceFileName: string;
    parserType:     string;
    parserVersion?: string;
    row?:           number;
    column?:        string | number;
    sheet?:         string;
    extractedAt?:   string;
  };
  pipelineSteps?: SemanticStep[];
}

export function ExplainabilityPanel({
  whySuggested,
  whyRanked,
  influencingTokens = [],
  highlightTokens   = [],
  aliasesUsed       = [],
  lexicalScore,
  semanticScore,
  normalizationScore,
  parserScore,
  provenance,
  pipelineSteps     = [],
}: ExplainabilityPanelProps) {
  return (
    <Tabs defaultValue="influence" className="space-y-3">
      <TabsList>
        <TabsTrigger value="influence"  className="text-xs">Influências</TabsTrigger>
        <TabsTrigger value="tokens"     className="text-xs">Tokens</TabsTrigger>
        <TabsTrigger value="provenance" className="text-xs">Proveniência</TabsTrigger>
        <TabsTrigger value="trace"      className="text-xs">Trace</TabsTrigger>
      </TabsList>

      <TabsContent value="influence" className="space-y-4">
        {whySuggested && (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Por que foi sugerido</h3>
            <p className="text-sm text-muted-foreground">{whySuggested}</p>
          </div>
        )}
        {whyRanked && (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Por que está nesta posição</h3>
            <p className="text-sm text-muted-foreground">{whyRanked}</p>
          </div>
        )}
        <InfluenceBreakdown
          lexicalScore={lexicalScore}
          semanticScore={semanticScore}
          normalizationScore={normalizationScore}
          parserScore={parserScore}
        />
        {aliasesUsed.length > 0 && (
          <div className="space-y-1">
            <h3 className="text-sm font-medium">Aliases usados</h3>
            <div className="flex flex-wrap gap-1">
              {aliasesUsed.map(a => (
                <span key={a} className="text-xs bg-purple-50 text-purple-700 border border-purple-200 rounded px-1.5 py-0.5">
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}
      </TabsContent>

      <TabsContent value="tokens">
        <TokenEvidenceView tokens={influencingTokens} highlightTokens={highlightTokens} />
      </TabsContent>

      <TabsContent value="provenance">
        {provenance ? (
          <ProvenanceViewer {...provenance} />
        ) : (
          <p className="text-sm text-muted-foreground italic">Sem informações de proveniência disponíveis</p>
        )}
      </TabsContent>

      <TabsContent value="trace">
        <SemanticTraceView steps={pipelineSteps} />
      </TabsContent>
    </Tabs>
  );
}
