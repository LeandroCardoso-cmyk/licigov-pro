import { ArrowLeft, FileText, Package, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Clock, FileText as FileTextIcon } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DirectContractData } from "./types";

interface Props {
  contract: DirectContractData;
  onBack: () => void;
  onRequestOpinion: () => void;
  onCreateContract: () => void;
  onOpenPresentialPackage: () => void;
}

const STATUS_CONFIG: Record<string, { variant: "default" | "secondary" | "outline"; label: string; Icon: React.ElementType }> = {
  draft: { variant: "secondary", label: "Rascunho", Icon: Clock },
  approved: { variant: "default", label: "Aprovado", Icon: CheckCircle },
  published: { variant: "outline", label: "Publicado", Icon: FileTextIcon },
};

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const Icon = config.Icon;
  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      <Icon className="w-3 h-3" />
      {config.label}
    </Badge>
  );
}

function TypeBadge({ type }: { type: string }) {
  return type === "dispensa" ? (
    <Badge variant="default" className="bg-blue-500">Dispensa</Badge>
  ) : (
    <Badge variant="default" className="bg-purple-500">Inexigibilidade</Badge>
  );
}

export function DirectContractHeader({ contract, onBack, onRequestOpinion, onCreateContract, onOpenPresentialPackage }: Props) {
  return (
    <div className="mb-8">
      <Button variant="ghost" onClick={onBack} className="mb-4">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Voltar
      </Button>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <TypeBadge type={contract.type} />
            <StatusBadge status={contract.status} />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Nº {contract.number}/{contract.year}
            </span>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{contract.object}</h1>
          <p className="text-gray-600 dark:text-gray-400">
            {contract.legalArticle?.article} {contract.legalArticle?.inciso || ""}
          </p>
        </div>

        <div className="text-right space-y-3">
          <div className="text-3xl font-bold text-green-600">
            R$ {(contract.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Criado em {format(new Date(contract.createdAt), "dd/MM/yyyy", { locale: ptBR })}
          </p>
          <div className="flex gap-2 flex-wrap justify-end">
            <Button onClick={onRequestOpinion} variant="outline" size="sm">
              <Scale className="w-4 h-4 mr-2" />
              Solicitar Parecer
            </Button>
            {contract.mode === "presencial" && (
              <Button onClick={onOpenPresentialPackage} variant="default" size="sm">
                <Package className="w-4 h-4 mr-2" />
                Preparar Pacote Presencial
              </Button>
            )}
            <Button onClick={onCreateContract} variant="outline" size="sm">
              <FileText className="w-4 h-4 mr-2" />
              Gerar Contrato
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
