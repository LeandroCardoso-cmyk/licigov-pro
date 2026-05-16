import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_CONFIG: Record<string, { variant: any; label: string; icon: any }> = {
  draft: { variant: "secondary", label: "Rascunho", icon: Clock },
  approved: { variant: "default", label: "Aprovado", icon: CheckCircle },
  published: { variant: "outline", label: "Publicado", icon: FileText },
};

interface Contract {
  id: number;
  type: string;
  status: string;
  number: string;
  year: number;
  object: string;
  value: number;
  createdAt: Date | string;
  supplierName?: string | null;
  executionDeadline?: number | null;
  legalArticle?: { article?: string | null; inciso?: string | null } | null;
}

interface Props {
  contract: Contract;
  onClick: () => void;
}

export function DirectContractCard({ contract, onClick }: Props) {
  const statusCfg = STATUS_CONFIG[contract.status] ?? STATUS_CONFIG.draft;
  const StatusIcon = statusCfg.icon;

  return (
    <Card className="hover:shadow-lg transition-shadow cursor-pointer" onClick={onClick}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              {contract.type === "dispensa" ? (
                <Badge variant="default" className="bg-blue-500">Dispensa</Badge>
              ) : (
                <Badge variant="default" className="bg-purple-500">Inexigibilidade</Badge>
              )}
              <Badge variant={statusCfg.variant} className="flex items-center gap-1">
                <StatusIcon className="w-3 h-3" />{statusCfg.label}
              </Badge>
              <span className="text-sm text-gray-600 dark:text-gray-400">Nº {contract.number}/{contract.year}</span>
            </div>
            <CardTitle className="text-xl mb-2">{contract.object}</CardTitle>
            <CardDescription>
              {contract.legalArticle?.article} {contract.legalArticle?.inciso || ""}
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-green-600">
              R$ {(contract.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {formatDistanceToNow(new Date(contract.createdAt), { addSuffix: true, locale: ptBR })}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            {contract.supplierName && (
              <span className="text-gray-600 dark:text-gray-400">
                <strong>Fornecedor:</strong> {contract.supplierName}
              </span>
            )}
            {contract.executionDeadline && (
              <span className="text-gray-600 dark:text-gray-400">
                <strong>Prazo:</strong> {contract.executionDeadline} dias
              </span>
            )}
          </div>
          <Button variant="ghost" size="sm">Ver Detalhes →</Button>
        </div>
      </CardContent>
    </Card>
  );
}
