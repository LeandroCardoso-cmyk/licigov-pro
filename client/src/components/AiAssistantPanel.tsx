import { useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { Streamdown } from "streamdown";
import {
  Sparkles, AlertTriangle, FileText, Scale, Wrench, Loader2, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface Props {
  processId: number;
  activeDocType?: string;
}

type Tab = "modality" | "risks" | "clauses" | "technical" | "legal" | "improve";

interface Result {
  tab: Tab;
  content: string;
}

const TAB_CONFIG: Record<Tab, { label: string; icon: React.ReactNode; description: string }> = {
  modality: { label: "Modalidade", icon: <Scale className="h-4 w-4" />, description: "Recomendação de modalidade licitatória" },
  risks: { label: "Riscos", icon: <AlertTriangle className="h-4 w-4" />, description: "Análise de riscos jurídicos e operacionais" },
  clauses: { label: "Cláusulas", icon: <FileText className="h-4 w-4" />, description: "Sugestão de cláusula contratual" },
  technical: { label: "Exigências", icon: <Wrench className="h-4 w-4" />, description: "Exigências técnicas para o TR" },
  legal: { label: "Fundamentação", icon: <Scale className="h-4 w-4" />, description: "Base jurídica para decisão" },
  improve: { label: "Melhorar texto", icon: <Sparkles className="h-4 w-4" />, description: "Melhora um trecho do documento" },
};

export function AiAssistantPanel({ processId, activeDocType = "etp" }: Props) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("modality");
  const [result, setResult] = useState<Result | null>(null);
  const [clauseType, setClauseType] = useState("");
  const [legalQuestion, setLegalQuestion] = useState("");
  const [textToImprove, setTextToImprove] = useState("");

  /* ─── Mutations ─────────────────────────────────────────────────── */

  const modalityMutation = trpc.aiAssistant.suggestModality.useMutation({
    onSuccess: (data) => setResult({ tab: "modality", content: data.suggestion }),
    onError: (e) => toast.error("Erro na sugestão de modalidade", { description: e.message }),
  });

  const risksMutation = trpc.aiAssistant.suggestRisks.useMutation({
    onSuccess: (data) => setResult({ tab: "risks", content: data.suggestion }),
    onError: (e) => toast.error("Erro na análise de riscos", { description: e.message }),
  });

  const clausesMutation = trpc.aiAssistant.suggestClauses.useMutation({
    onSuccess: (data) => setResult({ tab: "clauses", content: data.suggestion }),
    onError: (e) => toast.error("Erro na sugestão de cláusula", { description: e.message }),
  });

  const technicalMutation = trpc.aiAssistant.suggestTechnicalRequirements.useMutation({
    onSuccess: (data) => setResult({ tab: "technical", content: data.suggestion }),
    onError: (e) => toast.error("Erro na sugestão de exigências", { description: e.message }),
  });

  const legalMutation = trpc.aiAssistant.suggestLegalBasis.useMutation({
    onSuccess: (data) => setResult({ tab: "legal", content: data.suggestion }),
    onError: (e) => toast.error("Erro na fundamentação jurídica", { description: e.message }),
  });

  const improveMutation = trpc.aiAssistant.improveText.useMutation({
    onSuccess: (data) => setResult({ tab: "improve", content: data.suggestion }),
    onError: (e) => toast.error("Erro ao melhorar texto", { description: e.message }),
  });

  const isPending =
    modalityMutation.isPending ||
    risksMutation.isPending ||
    clausesMutation.isPending ||
    technicalMutation.isPending ||
    legalMutation.isPending ||
    improveMutation.isPending;

  /* ─── Handlers ───────────────────────────────────────────────────── */

  function handleGenerate() {
    setResult(null);
    switch (activeTab) {
      case "modality":   return modalityMutation.mutate({ processId });
      case "risks":      return risksMutation.mutate({ processId });
      case "clauses":
        if (!clauseType.trim()) return toast.error("Informe o tipo de cláusula");
        return clausesMutation.mutate({ processId, clauseType });
      case "technical":  return technicalMutation.mutate({ processId });
      case "legal":
        if (!legalQuestion.trim()) return toast.error("Informe a pergunta jurídica");
        return legalMutation.mutate({ processId, question: legalQuestion });
      case "improve":
        if (!textToImprove.trim()) return toast.error("Cole o texto a melhorar");
        return improveMutation.mutate({ processId, docType: activeDocType, textSnippet: textToImprove });
    }
  }

  const currentIsPending = (() => {
    switch (activeTab) {
      case "modality": return modalityMutation.isPending;
      case "risks":    return risksMutation.isPending;
      case "clauses":  return clausesMutation.isPending;
      case "technical":return technicalMutation.isPending;
      case "legal":    return legalMutation.isPending;
      case "improve":  return improveMutation.isPending;
    }
  })();

  /* ─── Render ─────────────────────────────────────────────────────── */

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          Assistente IA
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Assistente IA — Lei 14.133/21
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 flex flex-col overflow-hidden">
          <Tabs
            value={activeTab}
            onValueChange={(v) => { setActiveTab(v as Tab); setResult(null); }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <div className="px-4 pt-4 border-b">
              <TabsList className="grid grid-cols-3 mb-1 w-full">
                {(["modality", "risks", "technical"] as Tab[]).map((tab) => (
                  <TabsTrigger key={tab} value={tab} className="gap-1 text-xs">
                    {TAB_CONFIG[tab].icon}
                    {TAB_CONFIG[tab].label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsList className="grid grid-cols-3 w-full">
                {(["clauses", "legal", "improve"] as Tab[]).map((tab) => (
                  <TabsTrigger key={tab} value={tab} className="gap-1 text-xs">
                    {TAB_CONFIG[tab].icon}
                    {TAB_CONFIG[tab].label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="px-6 py-4 space-y-3 border-b">
              <p className="text-xs text-muted-foreground">{TAB_CONFIG[activeTab].description}</p>

              {activeTab === "clauses" && (
                <Input
                  placeholder='Ex: "vigência e prazos", "penalidades", "garantias"...'
                  value={clauseType}
                  onChange={(e) => setClauseType(e.target.value)}
                />
              )}

              {activeTab === "legal" && (
                <Textarea
                  placeholder='Ex: "É possível dispensar licitação para contratação emergencial de TI?" ...'
                  value={legalQuestion}
                  onChange={(e) => setLegalQuestion(e.target.value)}
                  rows={3}
                />
              )}

              {activeTab === "improve" && (
                <Textarea
                  placeholder="Cole aqui o trecho do documento que deseja melhorar..."
                  value={textToImprove}
                  onChange={(e) => setTextToImprove(e.target.value)}
                  rows={4}
                />
              )}

              <Button
                className="w-full gap-2"
                onClick={handleGenerate}
                disabled={currentIsPending}
              >
                {currentIsPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : result?.tab === activeTab ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {currentIsPending
                  ? "Analisando..."
                  : result?.tab === activeTab
                  ? "Gerar novamente"
                  : "Gerar sugestão"}
              </Button>
            </div>

            <ScrollArea className="flex-1 px-6 py-4">
              {result?.tab === activeTab ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <Streamdown>{result.content}</Streamdown>
                </div>
              ) : (
                <EmptyState
                  icon={Sparkles}
                  title="Nenhuma sugestão gerada"
                  description='Clique em "Gerar sugestão" para obter uma análise contextualizada do processo atual.'
                />
              )}
            </ScrollArea>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  );
}
