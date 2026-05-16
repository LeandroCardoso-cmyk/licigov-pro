import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, Calendar } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function getAlertBadge(days: number) {
  if (days < 0) {
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" />
        Vencido há {Math.abs(days)} dias
      </Badge>
    );
  } else if (days <= 30) {
    return (
      <Badge variant="destructive" className="flex items-center gap-1">
        <Clock className="h-3 w-3" />
        Vence em {days} dias
      </Badge>
    );
  } else if (days <= 60) {
    return (
      <Badge className="flex items-center gap-1 bg-orange-500 hover:bg-orange-600">
        <Clock className="h-3 w-3" />
        Vence em {days} dias
      </Badge>
    );
  } else if (days <= 90) {
    return (
      <Badge className="flex items-center gap-1 bg-yellow-500 hover:bg-yellow-600">
        <Clock className="h-3 w-3" />
        Vence em {days} dias
      </Badge>
    );
  }
  return null;
}

interface Contract {
  id: number;
  number: string;
  year: number;
  object: string;
  contractorName: string;
  currentValue: number;
  endDate: string | Date;
  fiscalUserName?: string | null;
  daysUntilExpiry: number;
}

interface Props {
  contract: Contract;
  onClick: () => void;
}

export function ContractAlertCard({ contract, onClick }: Props) {
  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={onClick}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <CardTitle className="text-lg">
                Contrato {contract.number}/{contract.year}
              </CardTitle>
              {getAlertBadge(contract.daysUntilExpiry)}
            </div>
            <CardDescription>{contract.object}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <span className="text-sm text-muted-foreground">Contratado</span>
            <p className="font-medium">{contract.contractorName}</p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Valor Atual</span>
            <p className="font-medium">
              {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(contract.currentValue)}
            </p>
          </div>
          <div>
            <span className="text-sm text-muted-foreground">Data de Término</span>
            <p className="font-medium flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              {format(new Date(contract.endDate), "dd/MM/yyyy", { locale: ptBR })}
            </p>
          </div>
        </div>
        {contract.fiscalUserName && (
          <div className="mt-4 pt-4 border-t">
            <span className="text-sm text-muted-foreground">Fiscal do Contrato</span>
            <p className="font-medium">{contract.fiscalUserName}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
