import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { WizardStepper } from "@/components/new-direct-contract/WizardStepper";
import { Step1LegalFramework } from "@/components/new-direct-contract/Step1LegalFramework";
import { Step2ContractData } from "@/components/new-direct-contract/Step2ContractData";
import { Step3Supplier } from "@/components/new-direct-contract/Step3Supplier";
import { Step4Review } from "@/components/new-direct-contract/Step4Review";

const STEP_DESCRIPTIONS = [
  "Identifique o tipo e o artigo legal aplicável",
  "Informe os dados da contratação",
  "Identifique o fornecedor (opcional)",
  "Revise as informações antes de criar",
];

const STEP_TITLES = ["Enquadramento Legal", "Dados da Contratação", "Fornecedor", "Revisão"];

export default function NewDirectContract() {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);

  // Step 1
  const [type, setType] = useState<"dispensa" | "inexigibilidade" | "">("");
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [situation, setSituation] = useState("");
  const [urgency] = useState("");
  const [hasExclusiveSupplier] = useState(false);

  // Shared step 1 + 2
  const [object, setObject] = useState("");
  const [value, setValue] = useState("");

  // Step 2
  const [number, setNumber] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [justification, setJustification] = useState("");
  const [executionDeadline, setExecutionDeadline] = useState("");
  const [mode, setMode] = useState<"presencial" | "eletronico">("presencial");
  const [platformId, setPlatformId] = useState<number | undefined>(undefined);

  // Step 3
  const [supplierName, setSupplierName] = useState("");
  const [supplierCNPJ, setSupplierCNPJ] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierContact, setSupplierContact] = useState("");

  // AI / CNPJ UI state
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [loadingAI, setLoadingAI] = useState(false);
  const [cnpjValidation, setCnpjValidation] = useState<{ isValid: boolean; error?: string } | null>(null);
  const [cnpjData, setCnpjData] = useState<any>(null);
  const [loadingCNPJ, setLoadingCNPJ] = useState(false);

  const { data: articles } = trpc.directContracts.legalArticles.list.useQuery(
    type ? { type } : undefined,
    { enabled: !!type }
  );
  const { data: platforms } = trpc.directContracts.platforms.list.useQuery();

  const suggestArticleMutation = trpc.directContracts.assistant.suggestArticle.useMutation();
  const generateJustificationMutation = trpc.directContracts.assistant.generateJustification.useMutation();
  const consultCNPJMutation = trpc.directContracts.validation.consultCNPJ.useMutation();
  const createMutation = trpc.directContracts.create.useMutation();

  const handleSuggestArticle = async () => {
    if (!situation || !object || !value) { toast.error("Preencha situação, objeto e valor estimado"); return; }
    setLoadingAI(true);
    try {
      const result = await suggestArticleMutation.mutateAsync({
        situation, object, estimatedValue: parseFloat(value) * 100, urgency, hasExclusiveSupplier,
      });
      setAiSuggestion(result);
      setType(result.articleType);
      setSelectedArticleId(result.articleId);
      toast.success("Artigo legal sugerido pela IA!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao sugerir artigo");
    } finally {
      setLoadingAI(false);
    }
  };

  const handleGenerateJustification = async () => {
    if (!selectedArticleId || !object || !situation || !value) {
      toast.error("Selecione um artigo legal primeiro"); return;
    }
    setLoadingAI(true);
    try {
      const result = await generateJustificationMutation.mutateAsync({
        articleId: selectedArticleId, object, situation, estimatedValue: parseFloat(value) * 100,
      });
      setJustification(result as string);
      toast.success("Justificativa gerada pela IA!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao gerar justificativa");
    } finally {
      setLoadingAI(false);
    }
  };

  const handleValidateCNPJ = async () => {
    if (!supplierCNPJ || supplierCNPJ.length < 14) { setCnpjValidation(null); setCnpjData(null); return; }
    setLoadingCNPJ(true);
    try {
      const result = await consultCNPJMutation.mutateAsync({ cnpj: supplierCNPJ });
      if (result.success && result.data) {
        setCnpjValidation({ isValid: true });
        setCnpjData(result.data);
        if (!supplierName) setSupplierName(result.data.nomeFantasia || result.data.razaoSocial);
        if (!supplierAddress && result.data.endereco)
          setSupplierAddress(`${result.data.endereco}, ${result.data.municipio}/${result.data.uf}`);
        toast.success("CNPJ válido! Dados preenchidos automaticamente.");
      } else {
        setCnpjValidation({ isValid: false, error: result.error });
        setCnpjData(null);
        toast.error(result.error || "CNPJ inválido");
      }
    } catch {
      setCnpjValidation({ isValid: false, error: "Erro ao validar CNPJ" });
      setCnpjData(null);
      toast.error("Erro ao validar CNPJ");
    } finally {
      setLoadingCNPJ(false);
    }
  };

  const handleNext = () => {
    if (currentStep === 1 && (!type || !selectedArticleId)) {
      toast.error("Selecione o tipo e o artigo legal"); return;
    }
    if (currentStep === 2 && (!number || !object || !justification || !value)) {
      toast.error("Preencha todos os campos obrigatórios"); return;
    }
    setCurrentStep((p) => Math.min(p + 1, 4));
  };

  const handleSubmit = async () => {
    if (!type || !selectedArticleId || !number || !object || !justification || !value) {
      toast.error("Preencha todos os campos obrigatórios"); return;
    }
    try {
      const result = await createMutation.mutateAsync({
        number, year, type, legalArticleId: selectedArticleId, object, justification,
        value: parseFloat(value) * 100,
        executionDeadline: executionDeadline ? parseInt(executionDeadline) : undefined,
        supplierName: supplierName || undefined, supplierCNPJ: supplierCNPJ || undefined,
        supplierAddress: supplierAddress || undefined, supplierContact: supplierContact || undefined,
        mode, platformId,
      });
      toast.success("Contratação direta criada com sucesso!");
      setLocation(`/direct-contracts/${result.id}`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar contratação direta");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <Button variant="ghost" onClick={() => setLocation("/direct-contracts")} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <Breadcrumbs
            items={[{ label: "Contratação Direta", href: "/direct-contracts" }, { label: "Nova Contratação" }]}
            className="mb-2"
          />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Nova Contratação Direta</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">Dispensa ou Inexigibilidade de Licitação</p>
        </div>

        <WizardStepper currentStep={currentStep} />

        <Card>
          <CardHeader>
            <CardTitle>{STEP_TITLES[currentStep - 1]}</CardTitle>
            <CardDescription>{STEP_DESCRIPTIONS[currentStep - 1]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {currentStep === 1 && (
              <Step1LegalFramework
                type={type} selectedArticleId={selectedArticleId} situation={situation}
                object={object} value={value} aiSuggestion={aiSuggestion} loadingAI={loadingAI}
                articles={articles}
                onTypeChange={setType} onSituationChange={setSituation}
                onObjectChange={setObject} onValueChange={setValue}
                onArticleChange={setSelectedArticleId} onSuggestArticle={handleSuggestArticle}
              />
            )}
            {currentStep === 2 && (
              <Step2ContractData
                number={number} year={year} object={object} justification={justification}
                value={value} executionDeadline={executionDeadline} mode={mode} platformId={platformId}
                selectedArticleId={selectedArticleId} loadingAI={loadingAI} platforms={platforms}
                onNumberChange={setNumber} onYearChange={setYear} onObjectChange={setObject}
                onJustificationChange={setJustification} onValueChange={setValue}
                onExecutionDeadlineChange={setExecutionDeadline} onModeChange={setMode}
                onPlatformIdChange={setPlatformId} onGenerateJustification={handleGenerateJustification}
              />
            )}
            {currentStep === 3 && (
              <Step3Supplier
                supplierName={supplierName} supplierCNPJ={supplierCNPJ}
                supplierAddress={supplierAddress} supplierContact={supplierContact}
                cnpjValidation={cnpjValidation} cnpjData={cnpjData} loadingCNPJ={loadingCNPJ}
                onSupplierNameChange={setSupplierName} onSupplierCNPJChange={setSupplierCNPJ}
                onSupplierAddressChange={setSupplierAddress} onSupplierContactChange={setSupplierContact}
                onValidateCNPJ={handleValidateCNPJ}
              />
            )}
            {currentStep === 4 && (
              <Step4Review
                type={type} selectedArticleId={selectedArticleId} articles={articles}
                number={number} year={year} object={object} value={value}
                executionDeadline={executionDeadline} mode={mode}
                supplierName={supplierName} supplierCNPJ={supplierCNPJ}
                supplierAddress={supplierAddress} supplierContact={supplierContact}
              />
            )}

            <div className="flex justify-between pt-6 border-t">
              <Button variant="outline" onClick={() => setCurrentStep((p) => Math.max(p - 1, 1))} disabled={currentStep === 1}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Anterior
              </Button>
              {currentStep < 4 ? (
                <Button onClick={handleNext}>
                  Próximo <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              ) : (
                <Button onClick={handleSubmit} disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Criando..." : "Criar Contratação"}
                  <Check className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
