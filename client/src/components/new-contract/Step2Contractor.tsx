import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface Props {
  contractorName: string;
  contractorCNPJ: string;
  contractorAddress: string;
  contractorContact: string;
  cnpjValid: boolean | null;
  cnpjData: any;
  validatePending: boolean;
  onContractorNameChange: (v: string) => void;
  onContractorCNPJChange: (v: string) => void;
  onContractorAddressChange: (v: string) => void;
  onContractorContactChange: (v: string) => void;
  onValidateCNPJ: () => void;
}

export function Step2Contractor({
  contractorName, contractorCNPJ, contractorAddress, contractorContact,
  cnpjValid, cnpjData, validatePending,
  onContractorNameChange, onContractorCNPJChange, onContractorAddressChange,
  onContractorContactChange, onValidateCNPJ,
}: Props) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="contractorCNPJ">CNPJ (opcional)</Label>
        <div className="flex gap-2">
          <Input
            id="contractorCNPJ"
            placeholder="00.000.000/0000-00"
            value={contractorCNPJ}
            onChange={(e) => onContractorCNPJChange(e.target.value)}
            className={cnpjValid === true ? "border-green-500" : cnpjValid === false ? "border-red-500" : ""}
          />
          <Button type="button" variant="outline" onClick={onValidateCNPJ} disabled={validatePending}>
            {validatePending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Validar"}
          </Button>
        </div>
        {cnpjValid && cnpjData && (
          <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-sm font-medium text-green-800">{cnpjData.razao_social}</p>
            <p className="text-xs text-green-600">Situação: {cnpjData.situacao}</p>
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="contractorName">Nome/Razão Social *</Label>
        <Input
          id="contractorName"
          placeholder="Nome da empresa ou pessoa"
          value={contractorName}
          onChange={(e) => onContractorNameChange(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="contractorAddress">Endereço</Label>
        <Input
          id="contractorAddress"
          placeholder="Endereço completo"
          value={contractorAddress}
          onChange={(e) => onContractorAddressChange(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="contractorContact">Contato</Label>
        <Input
          id="contractorContact"
          placeholder="Telefone ou e-mail"
          value={contractorContact}
          onChange={(e) => onContractorContactChange(e.target.value)}
        />
      </div>
    </div>
  );
}
