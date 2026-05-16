import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

interface CNPJValidation {
  isValid: boolean;
  error?: string;
}

interface CNPJData {
  razaoSocial: string;
  situacao: string;
}

interface Props {
  supplierName: string;
  supplierCNPJ: string;
  supplierAddress: string;
  supplierContact: string;
  cnpjValidation: CNPJValidation | null;
  cnpjData: CNPJData | null;
  loadingCNPJ: boolean;
  onSupplierNameChange: (v: string) => void;
  onSupplierCNPJChange: (v: string) => void;
  onSupplierAddressChange: (v: string) => void;
  onSupplierContactChange: (v: string) => void;
  onValidateCNPJ: () => void;
}

export function Step3Supplier({
  supplierName, supplierCNPJ, supplierAddress, supplierContact,
  cnpjValidation, cnpjData, loadingCNPJ,
  onSupplierNameChange, onSupplierCNPJChange, onSupplierAddressChange,
  onSupplierContactChange, onValidateCNPJ,
}: Props) {
  return (
    <div className="space-y-4">
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
          onChange={(e) => onSupplierNameChange(e.target.value)}
          placeholder="Ex: Empresa XYZ Ltda"
        />
      </div>

      <div>
        <Label htmlFor="supplierCNPJ">CNPJ</Label>
        <div className="flex gap-2">
          <Input
            id="supplierCNPJ"
            value={supplierCNPJ}
            onChange={(e) => onSupplierCNPJChange(e.target.value)}
            placeholder="Ex: 00.000.000/0000-00"
            className={cnpjValidation ? (cnpjValidation.isValid ? "border-green-500" : "border-red-500") : ""}
          />
          <Button type="button" variant="outline" onClick={onValidateCNPJ} disabled={loadingCNPJ || !supplierCNPJ}>
            {loadingCNPJ ? "Validando..." : "Validar"}
          </Button>
        </div>
        {cnpjValidation && !cnpjValidation.isValid && (
          <p className="text-sm text-red-600 mt-1">{cnpjValidation.error}</p>
        )}
        {cnpjData && (
          <div className="mt-2 p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md">
            <p className="text-sm text-green-800 dark:text-green-200"><strong>Razão Social:</strong> {cnpjData.razaoSocial}</p>
            <p className="text-sm text-green-800 dark:text-green-200"><strong>Situação:</strong> {cnpjData.situacao}</p>
          </div>
        )}
      </div>

      <div>
        <Label htmlFor="supplierAddress">Endereço</Label>
        <Input
          id="supplierAddress"
          value={supplierAddress}
          onChange={(e) => onSupplierAddressChange(e.target.value)}
          placeholder="Ex: Rua ABC, 123 - Centro"
        />
      </div>

      <div>
        <Label htmlFor="supplierContact">Contato (Telefone/Email)</Label>
        <Input
          id="supplierContact"
          value={supplierContact}
          onChange={(e) => onSupplierContactChange(e.target.value)}
          placeholder="Ex: (11) 98765-4321 / contato@empresa.com"
        />
      </div>
    </div>
  );
}
