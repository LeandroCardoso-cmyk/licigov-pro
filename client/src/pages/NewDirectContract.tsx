import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Sparkles, AlertCircle, FileText, User, Building } from "lucide-react";

/**
 * Formulário Wizard de Nova Contratação Direta
 * 4 Passos: Enquadramento Legal → Dados da Contratação → Fornecedor → Revisão
 */
export default function NewDirectContract() {
  const [, setLocation] = useLocation();
  const [currentStep, setCurrentStep] = useState(1);

  // Passo 1: Enquadramento Legal
  const [type, setType] = useState<"dispensa" | "inexigibilidade" | "">("");
  const [selectedArticleId, setSelectedArticleId] = useState<number | null>(null);
  const [situation, setSituation] = useState("");
  const [urgency, setUrgency] = useState("");
  const [hasExclusiveSupplier, setHasExclusiveSupplier] = useState(false);

  // Passo 2: Dados da Contratação
  const [number, setNumber] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [object, setObject] = useState("");
  const [justification, setJustification] = useState("");
  const [value, setValue] = useState("");
  const [executionDeadline, setExecutionDeadline] = useState("");
  const [mode, setMode] = useState<"presencial" | "eletronico">("presencial");
  const [platformId, setPlatformId] = useState<number | undefined>(undefined);

  // Passo 3: Fornecedor
  const [supplierName, setSupplierName] = useState("");
  const [supplierCNPJ, setSupplierCNPJ] = useState("");
  const [supplierAddress, setSupplierAddress] = useState("");
  const [supplierContact, setSupplierContact] = useState("");

  // Estados de UI
  const [aiSuggestion, setAiSuggestion] = useState<any>(null);
  const [loadingAI, setLoadingAI] = useState(false);

  // Queries
  const { data: articles } = trpc.directContracts.legalArticles.list.useQuery(
    type ? { type } : undefined,
    { enabled: !!type }
  );

  const { data: platforms } = trpc.directContracts.platforms.list.useQuery();

  // Mutations
  const suggestArticleMutation = trpc.directContracts.assistant.suggestArticle.useMutation();
  const generateJustificationMutation = trpc.directContracts.assistant.generateJustification.useMutation();
  const createMutation = trpc.directContracts.create.useMutation();

  const handleSuggestArticle = async () => {
    if (!situation || !object || !value) {
      toast.error("Preencha situação, objeto e valor estimado");
      return;
    }

    setLoadingAI(true);
    try {
      const result = await suggestArticleMutation.mutateAsync({
        situation,
        object,
        estimatedValue: parseFloat(value) * 100, // Converter para centavos
        urgency,
        hasExclusiveSupplier,
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
      toast.error("Selecione um artigo legal primeiro");
      return;
    }

    setLoadingAI(true);
    try {
      const result = await generateJustificationMutation.mutateAsync({
        articleId: selectedArticleId,
        object,
        situation,
        estimatedValue: parseFloat(value) * 100,
      });

      setJustification(result.justification);
      toast.success("Justificativa gerada pela IA!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao gerar justificativa");
    } finally {
      setLoadingAI(false);
    }
  };

  const handleNext = () => {
    // Validações por passo
    if (currentStep === 1) {
      if (!type || !selectedArticleId) {
        toast.error("Selecione o tipo e o artigo legal");
        return;
      }
    }

    if (currentStep === 2) {
      if (!number || !object || !justification || !value) {
        toast.error("Preencha todos os campos obrigatórios");
        return;
      }
    }

    setCurrentStep((prev) => Math.min(prev + 1, 4));
  };

  const handlePrevious = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleSubmit = async () => {
    if (!type || !selectedArticleId || !number || !object || !justification || !value) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    try {
      const result = await createMutation.mutateAsync({
        number,
        year,
        type,
        legalArticleId: selectedArticleId,
        object,
        justification,
        value: parseFloat(value) * 100, // Converter para centavos
        executionDeadline: executionDeadline ? parseInt(executionDeadline) : undefined,
        supplierName: supplierName || undefined,
        supplierCNPJ: supplierCNPJ || undefined,
        supplierAddress: supplierAddress || undefined,
        supplierContact: supplierContact || undefined,
        mode,
        platformId,
      });

      toast.success("Contratação direta criada com sucesso!");
      setLocation(`/direct-contracts/${result.id}`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar contratação direta");
    }
  };

  const steps = [
    { number: 1, title: "Enquadramento Legal", icon: FileText },
    { number: 2, title: "Dados da Contratação", icon: Building },
    { number: 3, title: "Fornecedor", icon: User },
    { number: 4, title: "Revisão", icon: Check },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => setLocation("/direct-contracts")}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Nova Contratação Direta
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-2">
            Dispensa ou Inexigibilidade de Licitação
          </p>
        </div>

        {/* Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isActive = currentStep === step.number;
              const isCompleted = currentStep > step.number;

              return (
                <div key={step.number} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center ${
                        isCompleted
                          ? "bg-green-500 text-white"
                          : isActive
                          ? "bg-blue-500 text-white"
                          : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
                      }`}
                    >
                      {isCompleted ? (
                        <Check className="w-6 h-6" />
                      ) : (
                        <Icon className="w-6 h-6" />
                      )}
                    </div>
                    <span
                      className={`text-sm mt-2 text-center ${
                        isActive
                          ? "font-semibold text-blue-600 dark:text-blue-400"
                          : "text-gray-600 dark:text-gray-400"
                      }`}
                    >
                      {step.title}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`flex-1 h-1 mx-4 ${
                        isCompleted
                          ? "bg-green-500"
                          : "bg-gray-200 dark:bg-gray-700"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <Card>
          <CardHeader>
            <CardTitle>{steps[currentStep - 1].title}</CardTitle>
            <CardDescription>
              {currentStep === 1 && "Identifique o tipo e o artigo legal aplicável"}
              {currentStep === 2 && "Informe os dados da contratação"}
              {currentStep === 3 && "Identifique o fornecedor (opcional)"}
              {currentStep === 4 && "Revise as informações antes de criar"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Passo 1: Enquadramento Legal */}
            {currentStep === 1 && (
              <>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="type">Tipo de Contratação *</Label>
                    <Select value={type} onValueChange={(v: any) => setType(v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o tipo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="dispensa">Dispensa de Licitação</SelectItem>
                        <SelectItem value="inexigibilidade">Inexigibilidade de Licitação</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />

                  <Alert>
                    <Sparkles className="w-4 h-4" />
                    <AlertDescription>
                      <strong>Assistente IA:</strong> Descreva sua situação e deixe a IA sugerir o artigo legal mais adequado!
                    </AlertDescription>
                  </Alert>

                  <div>
                    <Label htmlFor="situation">Descreva a Situação *</Label>
                    <Textarea
                      id="situation"
                      value={situation}
                      onChange={(e) => setSituation(e.target.value)}
                      placeholder="Ex: Necessidade de contratação emergencial de empresa para reparo de bomba d'água que abastece hospital municipal..."
                      rows={4}
                    />
                  </div>

                  <div>
                    <Label htmlFor="object-step1">Objeto da Contratação *</Label>
                    <Input
                      id="object-step1"
                      value={object}
                      onChange={(e) => setObject(e.target.value)}
                      placeholder="Ex: Contratação de empresa para reparo de bomba d'água"
                    />
                  </div>

                  <div>
                    <Label htmlFor="value-step1">Valor Estimado (R$) *</Label>
                    <Input
                      id="value-step1"
                      type="number"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder="Ex: 15000.00"
                      step="0.01"
                    />
                  </div>

                  <Button
                    onClick={handleSuggestArticle}
                    disabled={loadingAI || !situation || !object || !value}
                    className="w-full"
                  >
                    {loadingAI ? (
                      <>Analisando...</>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Sugerir Artigo Legal (IA)
                      </>
                    )}
                  </Button>

                  {aiSuggestion && (
                    <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
                      <Sparkles className="w-4 h-4 text-blue-600" />
                      <AlertDescription>
                        <div className="space-y-2">
                          <div>
                            <strong>Artigo Sugerido:</strong>{" "}
                            <Badge variant="outline">{aiSuggestion.articleNumber}</Badge>
                          </div>
                          <div>
                            <strong>Confiança:</strong> {aiSuggestion.confidence}%
                          </div>
                          <div>
                            <strong>Explicação:</strong> {aiSuggestion.reasoning}
                          </div>
                          {aiSuggestion.warnings && aiSuggestion.warnings.length > 0 && (
                            <div>
                              <strong>Alertas:</strong>
                              <ul className="list-disc list-inside mt-1">
                                {aiSuggestion.warnings.map((w: string, i: number) => (
                                  <li key={i} className="text-sm text-amber-700 dark:text-amber-400">{w}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  <Separator />

                  <div>
                    <Label htmlFor="article">Artigo Legal *</Label>
                    <Select
                      value={selectedArticleId?.toString() || ""}
                      onValueChange={(v) => setSelectedArticleId(parseInt(v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o artigo legal" />
                      </SelectTrigger>
                      <SelectContent>
                        {articles?.map((article) => (
                          <SelectItem key={article.id} value={article.id.toString()}>
                            {article.article} {article.inciso || ""} - {article.summary}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedArticleId && articles && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                        {articles.find((a) => a.id === selectedArticleId)?.description}
                      </p>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Passo 2: Dados da Contratação */}
            {currentStep === 2 && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="number">Número *</Label>
                    <Input
                      id="number"
                      value={number}
                      onChange={(e) => setNumber(e.target.value)}
                      placeholder="Ex: 001"
                    />
                  </div>
                  <div>
                    <Label htmlFor="year">Ano *</Label>
                    <Input
                      id="year"
                      type="number"
                      value={year}
                      onChange={(e) => setYear(parseInt(e.target.value))}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="object-step2">Objeto da Contratação *</Label>
                  <Textarea
                    id="object-step2"
                    value={object}
                    onChange={(e) => setObject(e.target.value)}
                    placeholder="Descreva detalhadamente o objeto"
                    rows={3}
                  />
                </div>

                <div>
                  <Label htmlFor="justification">Justificativa *</Label>
                  <Textarea
                    id="justification"
                    value={justification}
                    onChange={(e) => setJustification(e.target.value)}
                    placeholder="Justificativa técnica e jurídica"
                    rows={6}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateJustification}
                    disabled={loadingAI || !selectedArticleId}
                    className="mt-2"
                  >
                    {loadingAI ? (
                      <>Gerando...</>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 mr-2" />
                        Gerar com IA
                      </>
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="value-step2">Valor (R$) *</Label>
                    <Input
                      id="value-step2"
                      type="number"
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                      step="0.01"
                    />
                  </div>
                  <div>
                    <Label htmlFor="executionDeadline">Prazo de Execução (dias)</Label>
                    <Input
                      id="executionDeadline"
                      type="number"
                      value={executionDeadline}
                      onChange={(e) => setExecutionDeadline(e.target.value)}
                      placeholder="Ex: 30"
                    />
                  </div>
                </div>

                <Separator />

                <div>
                  <Label htmlFor="mode">Modo de Contratação *</Label>
                  <Select value={mode} onValueChange={(v: any) => setMode(v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="presencial">Presencial (ZIP + Email)</SelectItem>
                      <SelectItem value="eletronico">Eletrônico (Plataforma)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {mode === "eletronico" && (
                  <div>
                    <Label htmlFor="platform">Plataforma</Label>
                    <Select
                      value={platformId?.toString() || ""}
                      onValueChange={(v) => setPlatformId(parseInt(v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione a plataforma" />
                      </SelectTrigger>
                      <SelectContent>
                        {platforms?.map((platform) => (
                          <SelectItem key={platform.id} value={platform.id.toString()}>
                            {platform.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            {/* Passo 3: Fornecedor */}
            {currentStep === 3 && (
              <>
                <Alert>
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    Preencha os dados do fornecedor se já souber quem será contratado. Caso contrário, pode pular esta etapa.
                  </AlertDescription>
                </Alert>

                <div>
                  <Label htmlFor="supplierName">Nome do Fornecedor</Label>
                  <Input
                    id="supplierName"
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="Ex: Empresa XYZ Ltda"
                  />
                </div>

                <div>
                  <Label htmlFor="supplierCNPJ">CNPJ</Label>
                  <Input
                    id="supplierCNPJ"
                    value={supplierCNPJ}
                    onChange={(e) => setSupplierCNPJ(e.target.value)}
                    placeholder="Ex: 00.000.000/0000-00"
                  />
                </div>

                <div>
                  <Label htmlFor="supplierAddress">Endereço</Label>
                  <Input
                    id="supplierAddress"
                    value={supplierAddress}
                    onChange={(e) => setSupplierAddress(e.target.value)}
                    placeholder="Ex: Rua ABC, 123 - Centro"
                  />
                </div>

                <div>
                  <Label htmlFor="supplierContact">Contato (Telefone/Email)</Label>
                  <Input
                    id="supplierContact"
                    value={supplierContact}
                    onChange={(e) => setSupplierContact(e.target.value)}
                    placeholder="Ex: (11) 98765-4321 / contato@empresa.com"
                  />
                </div>
              </>
            )}

            {/* Passo 4: Revisão */}
            {currentStep === 4 && (
              <>
                <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
                  <Check className="w-4 h-4 text-green-600" />
                  <AlertDescription>
                    Revise as informações antes de criar a contratação direta.
                  </AlertDescription>
                </Alert>

                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-lg mb-2">Enquadramento Legal</h3>
                    <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-2">
                      <p><strong>Tipo:</strong> {type === "dispensa" ? "Dispensa de Licitação" : "Inexigibilidade de Licitação"}</p>
                      <p><strong>Artigo Legal:</strong> {articles?.find((a) => a.id === selectedArticleId)?.article} {articles?.find((a) => a.id === selectedArticleId)?.inciso || ""}</p>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold text-lg mb-2">Dados da Contratação</h3>
                    <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-2">
                      <p><strong>Número/Ano:</strong> {number}/{year}</p>
                      <p><strong>Objeto:</strong> {object}</p>
                      <p><strong>Valor:</strong> R$ {parseFloat(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
                      <p><strong>Prazo:</strong> {executionDeadline ? `${executionDeadline} dias` : "Não informado"}</p>
                      <p><strong>Modo:</strong> {mode === "presencial" ? "Presencial" : "Eletrônico"}</p>
                    </div>
                  </div>

                  {supplierName && (
                    <div>
                      <h3 className="font-semibold text-lg mb-2">Fornecedor</h3>
                      <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-2">
                        <p><strong>Nome:</strong> {supplierName}</p>
                        {supplierCNPJ && <p><strong>CNPJ:</strong> {supplierCNPJ}</p>}
                        {supplierAddress && <p><strong>Endereço:</strong> {supplierAddress}</p>}
                        {supplierContact && <p><strong>Contato:</strong> {supplierContact}</p>}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Navigation Buttons */}
            <div className="flex justify-between pt-6 border-t">
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={currentStep === 1}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Anterior
              </Button>

              {currentStep < 4 ? (
                <Button onClick={handleNext}>
                  Próximo
                  <ArrowRight className="w-4 h-4 ml-2" />
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
