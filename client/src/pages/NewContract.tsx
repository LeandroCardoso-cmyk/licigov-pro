import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Formulário Wizard de Novo Contrato
 * 3 passos: Dados Básicos, Contratado, Vigência
 */
export default function NewContract() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);

  // Passo 1: Dados Básicos
  const [number, setNumber] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [object, setObject] = useState("");
  const [type, setType] = useState<string>("");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");

  // Passo 2: Contratado
  const [contractorName, setContractorName] = useState("");
  const [contractorCNPJ, setContractorCNPJ] = useState("");
  const [contractorAddress, setContractorAddress] = useState("");
  const [contractorContact, setContractorContact] = useState("");
  const [cnpjValid, setCnpjValid] = useState<boolean | null>(null);
  const [cnpjData, setCnpjData] = useState<any>(null);

  // Passo 3: Vigência
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [autoRenewal, setAutoRenewal] = useState(false);
  const [maxRenewals, setMaxRenewals] = useState("0");
  const [fiscalUserName, setFiscalUserName] = useState("");

  // Mutations
  const createMutation = trpc.contracts.create.useMutation({
    onSuccess: (data) => {
      toast.success("Contrato criado com sucesso!");
      setLocation(`/contracts/${data.id}`);
    },
    onError: (error) => {
      toast.error(`Erro ao criar contrato: ${error.message}`);
    },
  });

  const validateCNPJMutation = trpc.directContracts.validation.consultCNPJ.useMutation({
    onSuccess: (data) => {
      if (data.valid) {
        setCnpjValid(true);
        setCnpjData(data);
        setContractorName(data.razao_social || "");
        setContractorAddress(
          data.logradouro && data.municipio
            ? `${data.logradouro}, ${data.numero || "S/N"}, ${data.bairro || ""}, ${data.municipio}/${data.uf}, CEP ${data.cep || ""}`
            : ""
        );
        toast.success("CNPJ válido! Dados preenchidos automaticamente.");
      } else {
        setCnpjValid(false);
        setCnpjData(null);
        toast.error(data.error || "CNPJ inválido");
      }
    },
    onError: () => {
      setCnpjValid(false);
      setCnpjData(null);
      toast.error("Erro ao validar CNPJ");
    },
  });

  const handleValidateCNPJ = () => {
    if (!contractorCNPJ) {
      toast.error("Digite um CNPJ");
      return;
    }
    validateCNPJMutation.mutate({ cnpj: contractorCNPJ });
  };

  const handleNext = () => {
    // Validações por passo
    if (step === 1) {
      if (!number || !object || !type || !value) {
        toast.error("Preencha todos os campos obrigatórios");
        return;
      }
    } else if (step === 2) {
      if (!contractorName) {
        toast.error("Preencha o nome do contratado");
        return;
      }
    }
    setStep(step + 1);
  };

  const handleBack = () => {
    setStep(step - 1);
  };

  const handleSubmit = () => {
    // Validações finais
    if (!startDate || !endDate) {
      toast.error("Preencha as datas de vigência");
      return;
    }

    const valueNum = parseFloat(value.replace(/[^\d,]/g, "").replace(",", "."));
    if (isNaN(valueNum) || valueNum <= 0) {
      toast.error("Valor inválido");
      return;
    }

    createMutation.mutate({
      number,
      year,
      object,
      type: type as any,
      contractorName,
      contractorCNPJ: contractorCNPJ || undefined,
      contractorAddress: contractorAddress || undefined,
      contractorContact: contractorContact || undefined,
      value: valueNum,
      currentValue: valueNum,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      autoRenewal,
      maxRenewals: parseInt(maxRenewals) || 0,
      fiscalUserName: fiscalUserName || undefined,
      status: "draft",
      notes: notes || undefined,
    });
  };

  // Calcular prazo em dias
  const calculateDays = () => {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = end.getTime() - start.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/contracts")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">Novo Contrato</h1>
              <p className="text-muted-foreground mt-1">
                Passo {step} de 3
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container py-8 max-w-3xl">
        {/* Indicador de Passos */}
        <div className="flex items-center justify-between mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center flex-1">
              <div
                className={`flex items-center justify-center w-10 h-10 rounded-full border-2 ${
                  s < step
                    ? "bg-primary border-primary text-primary-foreground"
                    : s === step
                    ? "border-primary text-primary"
                    : "border-muted text-muted-foreground"
                }`}
              >
                {s < step ? <Check className="h-5 w-5" /> : s}
              </div>
              {s < 3 && (
                <div
                  className={`flex-1 h-0.5 mx-2 ${
                    s < step ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Passo 1: Dados Básicos */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Dados Básicos do Contrato</CardTitle>
              <CardDescription>
                Informe o número, objeto e valor do contrato
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="number">Número do Contrato *</Label>
                  <Input
                    id="number"
                    placeholder="Ex: 001"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
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
                <Label htmlFor="object">Objeto do Contrato *</Label>
                <Textarea
                  id="object"
                  placeholder="Descreva o objeto do contrato..."
                  value={object}
                  onChange={(e) => setObject(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="type">Tipo de Contrato *</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fornecimento">Fornecimento</SelectItem>
                      <SelectItem value="servico">Serviço</SelectItem>
                      <SelectItem value="obra">Obra</SelectItem>
                      <SelectItem value="concessao">Concessão</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="value">Valor do Contrato (R$) *</Label>
                  <Input
                    id="value"
                    placeholder="Ex: 150.000,00"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="notes">Observações</Label>
                <Textarea
                  id="notes"
                  placeholder="Informações adicionais..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Passo 2: Contratado */}
        {step === 2 && (
          <Card>
            <CardHeader>
              <CardTitle>Dados do Contratado</CardTitle>
              <CardDescription>
                Informe os dados da empresa ou pessoa contratada
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="contractorCNPJ">CNPJ (opcional)</Label>
                <div className="flex gap-2">
                  <Input
                    id="contractorCNPJ"
                    placeholder="00.000.000/0000-00"
                    value={contractorCNPJ}
                    onChange={(e) => {
                      setContractorCNPJ(e.target.value);
                      setCnpjValid(null);
                      setCnpjData(null);
                    }}
                    className={
                      cnpjValid === true
                        ? "border-green-500"
                        : cnpjValid === false
                        ? "border-red-500"
                        : ""
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleValidateCNPJ}
                    disabled={validateCNPJMutation.isPending}
                  >
                    {validateCNPJMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Validar"
                    )}
                  </Button>
                </div>
                {cnpjValid && cnpjData && (
                  <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
                    <p className="text-sm font-medium text-green-800">
                      {cnpjData.razao_social}
                    </p>
                    <p className="text-xs text-green-600">
                      Situação: {cnpjData.situacao}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <Label htmlFor="contractorName">Nome/Razão Social *</Label>
                <Input
                  id="contractorName"
                  placeholder="Nome da empresa ou pessoa"
                  value={contractorName}
                  onChange={(e) => setContractorName(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="contractorAddress">Endereço</Label>
                <Input
                  id="contractorAddress"
                  placeholder="Endereço completo"
                  value={contractorAddress}
                  onChange={(e) => setContractorAddress(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="contractorContact">Contato</Label>
                <Input
                  id="contractorContact"
                  placeholder="Telefone ou e-mail"
                  value={contractorContact}
                  onChange={(e) => setContractorContact(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Passo 3: Vigência */}
        {step === 3 && (
          <Card>
            <CardHeader>
              <CardTitle>Vigência e Fiscalização</CardTitle>
              <CardDescription>
                Defina o período de vigência e o fiscal do contrato
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="startDate">Data de Início *</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>

                <div>
                  <Label htmlFor="endDate">Data de Término *</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>

              {startDate && endDate && (
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-sm text-muted-foreground">
                    Prazo: <span className="font-semibold text-foreground">{calculateDays()} dias</span>
                  </p>
                </div>
              )}

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="autoRenewal"
                  checked={autoRenewal}
                  onCheckedChange={(checked) => setAutoRenewal(checked as boolean)}
                />
                <Label htmlFor="autoRenewal" className="cursor-pointer">
                  Permitir renovação automática
                </Label>
              </div>

              {autoRenewal && (
                <div>
                  <Label htmlFor="maxRenewals">Número Máximo de Renovações</Label>
                  <Input
                    id="maxRenewals"
                    type="number"
                    min="0"
                    value={maxRenewals}
                    onChange={(e) => setMaxRenewals(e.target.value)}
                  />
                </div>
              )}

              <div>
                <Label htmlFor="fiscalUserName">Fiscal do Contrato</Label>
                <Input
                  id="fiscalUserName"
                  placeholder="Nome do servidor responsável"
                  value={fiscalUserName}
                  onChange={(e) => setFiscalUserName(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Botões de Navegação */}
        <div className="flex justify-between mt-6">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={step === 1}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>

          {step < 3 ? (
            <Button onClick={handleNext}>
              Próximo
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Criando...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Criar Contrato
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
