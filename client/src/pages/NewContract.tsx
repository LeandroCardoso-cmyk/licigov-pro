import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { toast } from "sonner";
import { ContractStepper } from "@/components/new-contract/ContractStepper";
import { Step1BasicData } from "@/components/new-contract/Step1BasicData";
import { Step2Contractor } from "@/components/new-contract/Step2Contractor";
import { Step3Validity } from "@/components/new-contract/Step3Validity";

const STEP_TITLES = ["Dados Básicos do Contrato", "Dados do Contratado", "Vigência e Fiscalização"];
const STEP_DESCRIPTIONS = [
  "Informe o número, objeto e valor do contrato",
  "Informe os dados da empresa ou pessoa contratada",
  "Defina o período de vigência e o fiscal do contrato",
];

export default function NewContract() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(1);

  // Step 1
  const [number, setNumber] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [object, setObject] = useState("");
  const [type, setType] = useState("");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");

  // Step 2
  const [contractorName, setContractorName] = useState("");
  const [contractorCNPJ, setContractorCNPJ] = useState("");
  const [contractorAddress, setContractorAddress] = useState("");
  const [contractorContact, setContractorContact] = useState("");
  const [cnpjValid, setCnpjValid] = useState<boolean | null>(null);
  const [cnpjData, setCnpjData] = useState<any>(null);

  // Step 3
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [autoRenewal, setAutoRenewal] = useState(false);
  const [maxRenewals, setMaxRenewals] = useState("0");
  const [fiscalUserName, setFiscalUserName] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const source = params.get("source");
    if (source === "process") {
      const n = params.get("number"); const o = params.get("object"); const v = params.get("value");
      if (n) setNumber(n); if (o) setObject(o); if (v) setValue(v);
      setType("fornecimento");
      toast.success("Dados pré-preenchidos do processo licitatório!");
    } else if (source === "direct") {
      const n = params.get("number"); const o = params.get("object"); const v = params.get("value");
      const cn = params.get("contractedName"); const cc = params.get("contractedCnpj");
      if (n) setNumber(n); if (o) setObject(o); if (v) setValue(v);
      if (cn) setContractorName(cn); if (cc) setContractorCNPJ(cc);
      setType("fornecimento");
      toast.success("Dados pré-preenchidos da contratação direta!");
    }
  }, []);

  const createMutation = trpc.contracts.create.useMutation({
    onSuccess: (data) => { toast.success("Contrato criado com sucesso!"); setLocation(`/contracts/${data?.id}`); },
    onError: (error) => toast.error(`Erro ao criar contrato: ${error.message}`),
  });

  const validateCNPJMutation = trpc.directContracts.validation.consultCNPJ.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setCnpjValid(true); setCnpjData(data);
        setContractorName(data.data?.razaoSocial || "");
        setContractorAddress(data.data?.endereco || "");
        toast.success("CNPJ válido! Dados preenchidos automaticamente.");
      } else {
        setCnpjValid(false); setCnpjData(null);
        toast.error(data.error || "CNPJ inválido");
      }
    },
    onError: () => { setCnpjValid(false); setCnpjData(null); toast.error("Erro ao validar CNPJ"); },
  });

  const handleValidateCNPJ = () => {
    if (!contractorCNPJ) { toast.error("Digite um CNPJ"); return; }
    validateCNPJMutation.mutate({ cnpj: contractorCNPJ });
  };

  const handleNext = () => {
    if (step === 1 && (!number || !object || !type || !value)) {
      toast.error("Preencha todos os campos obrigatórios"); return;
    }
    if (step === 2 && !contractorName) {
      toast.error("Preencha o nome do contratado"); return;
    }
    setStep((s) => s + 1);
  };

  const handleSubmit = () => {
    if (!startDate || !endDate) { toast.error("Preencha as datas de vigência"); return; }
    const valueNum = parseFloat(value.replace(/[^\d,]/g, "").replace(",", "."));
    if (isNaN(valueNum) || valueNum <= 0) { toast.error("Valor inválido"); return; }
    createMutation.mutate({
      number, year, object, type: type as any, contractorName,
      contractorCNPJ: contractorCNPJ || undefined, contractorAddress: contractorAddress || undefined,
      contractorContact: contractorContact || undefined, value: valueNum, currentValue: valueNum,
      startDate: new Date(startDate), endDate: new Date(endDate), autoRenewal,
      maxRenewals: parseInt(maxRenewals) || 0, fiscalUserName: fiscalUserName || undefined,
      status: "draft", notes: notes || undefined,
    });
  };

  const durationDays = (() => {
    if (!startDate || !endDate) return 0;
    return Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
  })();

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/contracts")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <Breadcrumbs
                items={[{ label: "Gestão de Contratos", href: "/contracts" }, { label: "Novo Contrato" }]}
                className="mb-2"
              />
              <h1 className="text-3xl font-bold">Novo Contrato</h1>
              <p className="text-muted-foreground mt-1">Passo {step} de 3</p>
            </div>
          </div>
        </div>
      </div>

      <div className="container py-8 max-w-3xl">
        <ContractStepper step={step} />

        <Card>
          <CardHeader>
            <CardTitle>{STEP_TITLES[step - 1]}</CardTitle>
            <CardDescription>{STEP_DESCRIPTIONS[step - 1]}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 1 && (
              <Step1BasicData
                number={number} year={year} object={object} type={type} value={value} notes={notes}
                onNumberChange={setNumber} onYearChange={setYear} onObjectChange={setObject}
                onTypeChange={setType} onValueChange={setValue} onNotesChange={setNotes}
              />
            )}
            {step === 2 && (
              <Step2Contractor
                contractorName={contractorName} contractorCNPJ={contractorCNPJ}
                contractorAddress={contractorAddress} contractorContact={contractorContact}
                cnpjValid={cnpjValid} cnpjData={cnpjData} validatePending={validateCNPJMutation.isPending}
                onContractorNameChange={setContractorName} onContractorCNPJChange={(v) => { setContractorCNPJ(v); setCnpjValid(null); setCnpjData(null); }}
                onContractorAddressChange={setContractorAddress} onContractorContactChange={setContractorContact}
                onValidateCNPJ={handleValidateCNPJ}
              />
            )}
            {step === 3 && (
              <Step3Validity
                startDate={startDate} endDate={endDate} autoRenewal={autoRenewal}
                maxRenewals={maxRenewals} fiscalUserName={fiscalUserName} durationDays={durationDays}
                onStartDateChange={setStartDate} onEndDateChange={setEndDate}
                onAutoRenewalChange={setAutoRenewal} onMaxRenewalsChange={setMaxRenewals}
                onFiscalUserNameChange={setFiscalUserName}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={step === 1}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
          {step < 3 ? (
            <Button onClick={handleNext}>
              Próximo <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Criando...</>
              ) : (
                <><Check className="h-4 w-4 mr-2" />Criar Contrato</>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
