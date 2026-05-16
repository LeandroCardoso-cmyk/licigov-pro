import { Building, User, FileCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { DirectContractData } from "./types";

const brl = (cents: number) =>
  `R$ ${(cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <Label className="text-gray-600 dark:text-gray-400">{label}</Label>
      <p className="font-medium">{value}</p>
    </div>
  );
}

export function OverviewTab({ contract }: { contract: DirectContractData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Dados da Contratação */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building className="w-5 h-5" />
            Dados da Contratação
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Objeto" value={contract.object} />
          <Separator />
          <div>
            <Label className="text-gray-600 dark:text-gray-400">Justificativa</Label>
            <p className="text-sm">{contract.justification}</p>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-gray-600 dark:text-gray-400">Valor</Label>
              <p className="font-medium text-green-600">{brl(contract.value)}</p>
            </div>
            {contract.executionDeadline && (
              <Field label="Prazo" value={`${contract.executionDeadline} dias`} />
            )}
          </div>
          <Separator />
          <Field
            label="Modo"
            value={contract.mode === "presencial" ? "Presencial (ZIP + Email)" : "Eletrônico (Plataforma)"}
          />
        </CardContent>
      </Card>

      {/* Fornecedor */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Fornecedor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {contract.supplierName ? (
            <>
              <Field label="Nome" value={contract.supplierName} />
              {contract.supplierCNPJ && (
                <>
                  <Separator />
                  <Field label="CNPJ" value={contract.supplierCNPJ} />
                </>
              )}
              {contract.supplierAddress && (
                <>
                  <Separator />
                  <div>
                    <Label className="text-gray-600 dark:text-gray-400">Endereço</Label>
                    <p className="text-sm">{contract.supplierAddress}</p>
                  </div>
                </>
              )}
              {contract.supplierContact && (
                <>
                  <Separator />
                  <div>
                    <Label className="text-gray-600 dark:text-gray-400">Contato</Label>
                    <p className="text-sm">{contract.supplierContact}</p>
                  </div>
                </>
              )}
            </>
          ) : (
            <p className="text-gray-600 dark:text-gray-400 text-center py-8">
              Fornecedor não informado
            </p>
          )}
        </CardContent>
      </Card>

      {/* Enquadramento Legal */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="w-5 h-5" />
            Enquadramento Legal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Artigo Legal"
            value={`${contract.legalArticle?.article ?? ""} ${contract.legalArticle?.inciso ?? ""}`}
          />
          <Separator />
          <div>
            <Label className="text-gray-600 dark:text-gray-400">Descrição</Label>
            <p className="text-sm">{contract.legalArticle?.description}</p>
          </div>
          {!!contract.legalArticle?.examples && (
            <>
              <Separator />
              <div>
                <Label className="text-gray-600 dark:text-gray-400">Exemplos de Aplicação</Label>
                <p className="text-sm">{String(contract.legalArticle.examples)}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
