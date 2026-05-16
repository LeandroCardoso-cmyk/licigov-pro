import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

const STATUS_CONFIG: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
  draft: { variant: "secondary", label: "Rascunho" },
  active: { variant: "default", label: "Ativo" },
  suspended: { variant: "outline", label: "Suspenso" },
  terminated: { variant: "destructive", label: "Rescindido" },
  expired: { variant: "destructive", label: "Vencido" },
  completed: { variant: "secondary", label: "Concluído" },
};

const TYPE_LABELS: Record<string, string> = {
  fornecimento: "Fornecimento",
  servico: "Serviço",
  obra: "Obra",
  concessao: "Concessão",
  outro: "Outro",
};

function daysUntilExpiry(endDate: Date) {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function expiryColor(endDate: Date, status: string) {
  if (status !== "active") return "";
  const days = daysUntilExpiry(endDate);
  if (days < 0) return "text-red-600";
  if (days <= 30) return "text-red-500";
  if (days <= 60) return "text-orange-500";
  if (days <= 90) return "text-yellow-600";
  return "";
}

interface Contract {
  id: number;
  number: string;
  year: number;
  status: string;
  type: string;
  object: string;
  contractorName: string;
  currentValue: number;
  startDate: Date;
  endDate: Date;
}

interface Props {
  contract: Contract;
  onClick: () => void;
}

export function ContractCard({ contract, onClick }: Props) {
  const days = daysUntilExpiry(contract.endDate);
  const color = expiryColor(contract.endDate, contract.status);
  const statusCfg = STATUS_CONFIG[contract.status] ?? { variant: "outline" as const, label: contract.status };

  const expiryLabel = contract.status === "active"
    ? days < 0 ? `Vencido há ${Math.abs(days)} dias`
    : days === 0 ? "Vence hoje"
    : days <= 90 ? `${days} dias`
    : formatDistanceToNow(new Date(contract.endDate), { addSuffix: true, locale: ptBR })
    : "-";

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-lg font-semibold">Contrato nº {contract.number}/{contract.year}</h3>
              <Badge variant={statusCfg.variant}>{statusCfg.label}</Badge>
              <Badge variant="outline">{TYPE_LABELS[contract.type] ?? contract.type}</Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{contract.object}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Contratado:</span>
                <p className="font-medium">{contract.contractorName}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Valor Atual:</span>
                <p className="font-medium">
                  {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(contract.currentValue)}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Vigência:</span>
                <p className="font-medium">
                  {new Date(contract.startDate).toLocaleDateString("pt-BR")} até{" "}
                  {new Date(contract.endDate).toLocaleDateString("pt-BR")}
                </p>
              </div>
              <div>
                <span className="text-muted-foreground">Vencimento:</span>
                <p className={`font-medium ${color}`}>{expiryLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export { daysUntilExpiry };
