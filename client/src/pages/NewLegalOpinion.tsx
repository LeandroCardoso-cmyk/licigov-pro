import { useAuth } from "@/_core/hooks/useAuth";
import { BackToDashboard } from "@/components/BackToDashboard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Scale, Loader2, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { toast } from "sonner";
import { SourceSelector } from "@/components/new-legal-opinion/SourceSelector";

type SourceType = "process" | "direct_contract" | "contract" | "other";

export default function NewLegalOpinion() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(useSearch());

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("other");
  const [sourceId, setSourceId] = useState("");
  const [legalQuestion, setLegalQuestion] = useState("");
  const [context, setContext] = useState("");
  const [requiredSignatures, setRequiredSignatures] = useState(1);

  useEffect(() => {
    const processId = searchParams.get("processId");
    const contractId = searchParams.get("contractId");
    const type = searchParams.get("type");
    if (processId) {
      setSourceType("process"); setSourceId(processId); setTitle("Parecer Jurídico - Processo Licitatório");
    } else if (contractId && type === "contratacao_direta") {
      setSourceType("direct_contract"); setSourceId(contractId); setTitle("Parecer Jurídico - Contratação Direta");
    }
  }, []);

  const createMutation = trpc.legalOpinions.create.useMutation();
  const generateMutation = trpc.legalOpinions.generateOpinion.useMutation();

  const { data: processes } = trpc.processes.list.useQuery(undefined, { enabled: sourceType === "process" });
  const { data: directContracts } = trpc.directContracts.list.useQuery(
    { type: undefined, status: undefined, year: undefined },
    { enabled: sourceType === "direct_contract" }
  );
  const { data: contracts } = trpc.contracts.list.useQuery(
    { status: undefined },
    { enabled: sourceType === "contract" }
  );

  const validate = () => {
    if (!title.trim()) { toast.error("Título é obrigatório"); return false; }
    if (!legalQuestion.trim() || legalQuestion.length < 10) {
      toast.error("Questão jurídica deve ter pelo menos 10 caracteres"); return false;
    }
    return true;
  };

  const buildPayload = () => ({
    title,
    description: description || undefined,
    sourceType,
    sourceId: sourceId && sourceId !== "none" ? parseInt(sourceId) : undefined,
    legalQuestion,
    context: context || undefined,
    requiredSignatures,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const result = await createMutation.mutateAsync(buildPayload());
      toast.success("Parecer criado com sucesso!");
      navigate(`/parecer-juridico/${result.id}`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar parecer");
    }
  };

  const handleCreateAndGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const result = await createMutation.mutateAsync(buildPayload());
      toast.success("Parecer criado! Gerando análise com IA...");
      await generateMutation.mutateAsync({ id: result.id });
      toast.success("Parecer gerado com sucesso!");
      navigate(`/parecer-juridico/${result.id}`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao gerar parecer");
    }
  };

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const isLoading = createMutation.isPending || generateMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <BackToDashboard />
            <div>
              <Breadcrumbs items={[{ label: "Parecer Jurídico", href: "/parecer-juridico" }, { label: "Novo Parecer" }]} className="mb-1" />
              <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                <Scale className="h-6 w-6 text-primary" />Novo Parecer Jurídico
              </h1>
              <p className="text-sm text-muted-foreground">Solicite uma análise jurídica automatizada com IA</p>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Informações do Parecer</CardTitle>
              <CardDescription>Preencha os dados para solicitar um parecer jurídico baseado na Lei 14.133/2021</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">Título *</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Análise de Dispensa de Licitação por Emergência" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrição (opcional)</Label>
                <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Breve resumo do caso..." rows={3} />
              </div>

              <SourceSelector
                sourceType={sourceType}
                sourceId={sourceId}
                processes={processes}
                directContracts={directContracts}
                contracts={contracts}
                onSourceTypeChange={setSourceType}
                onSourceIdChange={setSourceId}
              />

              <div className="space-y-2">
                <Label htmlFor="legalQuestion">Questão Jurídica *</Label>
                <Textarea id="legalQuestion" value={legalQuestion} onChange={(e) => setLegalQuestion(e.target.value)} placeholder="Descreva a questão jurídica que precisa ser analisada..." rows={5} required />
                <p className="text-xs text-muted-foreground">Mínimo de 10 caracteres</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="context">Contexto Adicional (opcional)</Label>
                <Textarea id="context" value={context} onChange={(e) => setContext(e.target.value)} placeholder="Informações complementares que possam auxiliar na análise..." rows={4} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="requiredSignatures">Assinaturas Necessárias</Label>
                <Select value={requiredSignatures.toString()} onValueChange={(v) => setRequiredSignatures(parseInt(v))}>
                  <SelectTrigger id="requiredSignatures"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 assinatura (padrão)</SelectItem>
                    <SelectItem value="2">2 assinaturas (revisor + responsável)</SelectItem>
                    <SelectItem value="3">3 assinaturas (revisor + responsável + gestor)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">Define quantas assinaturas digitais são necessárias para validar este parecer</p>
              </div>

              <div className="flex gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => navigate("/parecer-juridico")} disabled={isLoading}>Cancelar</Button>
                <Button type="submit" variant="outline" disabled={isLoading}>
                  {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Salvar Rascunho
                </Button>
                <Button type="button" onClick={handleCreateAndGenerate} disabled={isLoading} className="ml-auto">
                  {generateMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Gerando com IA...</>
                  ) : (
                    <><Sparkles className="h-4 w-4 mr-2" />Criar e Gerar com IA</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  );
}
