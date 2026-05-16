import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check } from "lucide-react";

interface Article {
  id: number;
  article: string;
  inciso?: string | null;
}

interface Props {
  type: string;
  selectedArticleId: number | null;
  articles: Article[] | undefined;
  number: string;
  year: number;
  object: string;
  value: string;
  executionDeadline: string;
  mode: string;
  supplierName: string;
  supplierCNPJ: string;
  supplierAddress: string;
  supplierContact: string;
}

export function Step4Review({
  type, selectedArticleId, articles,
  number, year, object, value, executionDeadline, mode,
  supplierName, supplierCNPJ, supplierAddress, supplierContact,
}: Props) {
  const selectedArticle = articles?.find((a) => a.id === selectedArticleId);

  return (
    <div className="space-y-4">
      <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
        <Check className="w-4 h-4 text-green-600" />
        <AlertDescription>Revise as informações antes de criar a contratação direta.</AlertDescription>
      </Alert>

      <div>
        <h3 className="font-semibold text-lg mb-2">Enquadramento Legal</h3>
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-2">
          <p><strong>Tipo:</strong> {type === "dispensa" ? "Dispensa de Licitação" : "Inexigibilidade de Licitação"}</p>
          <p>
            <strong>Artigo Legal:</strong>{" "}
            {selectedArticle ? `${selectedArticle.article} ${selectedArticle.inciso || ""}` : "—"}
          </p>
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-lg mb-2">Dados da Contratação</h3>
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg space-y-2">
          <p><strong>Número/Ano:</strong> {number}/{year}</p>
          <p><strong>Objeto:</strong> {object}</p>
          <p><strong>Valor:</strong> R$ {parseFloat(value || "0").toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</p>
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
  );
}
