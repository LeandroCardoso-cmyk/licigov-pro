import { User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ContractData } from "./types";

const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

const datePT = (d: Date | string) => new Date(d).toLocaleDateString("pt-BR");

export function ContractOverviewTab({ contract }: { contract: ContractData }) {
  const durationDays = Math.ceil(
    (new Date(contract.endDate).getTime() - new Date(contract.startDate).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Dados do Contrato */}
      <Card>
        <CardHeader>
          <CardTitle>Dados do Contrato</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className="text-sm text-muted-foreground">Tipo</span>
            <p className="font-medium capitalize">{contract.type}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Valor Original</span>
            <p className="font-medium">{brl(contract.value)}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Valor Atual</span>
            <p className="font-medium text-lg">{brl(contract.currentValue)}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Vigência</span>
            <p className="font-medium">
              {datePT(contract.startDate)} até {datePT(contract.endDate)}
            </p>
            <p className="text-sm text-muted-foreground">{durationDays} dias</p>
          </div>
          {contract.autoRenewal && (
            <div>
              <span className="text-sm text-muted-foreground">Renovação Automática</span>
              <p className="font-medium">Sim (máximo {contract.maxRenewals} renovações)</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dados do Contratado */}
      <Card>
        <CardHeader>
          <CardTitle>Contratado</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className="text-sm text-muted-foreground">Nome/Razão Social</span>
            <p className="font-medium">{contract.contractorName}</p>
          </div>
          {contract.contractorCNPJ && (
            <div>
              <span className="text-sm text-muted-foreground">CNPJ</span>
              <p className="font-medium">{contract.contractorCNPJ}</p>
            </div>
          )}
          {contract.contractorAddress && (
            <div>
              <span className="text-sm text-muted-foreground">Endereço</span>
              <p className="font-medium">{contract.contractorAddress}</p>
            </div>
          )}
          {contract.contractorContact && (
            <div>
              <span className="text-sm text-muted-foreground">Contato</span>
              <p className="font-medium">{contract.contractorContact}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fiscal do Contrato */}
      {contract.fiscalUserName && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Fiscalização</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <div>
                <span className="text-sm text-muted-foreground">Fiscal Responsável</span>
                <p className="font-medium">{contract.fiscalUserName}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Observações */}
      {contract.notes && (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Observações</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{contract.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
