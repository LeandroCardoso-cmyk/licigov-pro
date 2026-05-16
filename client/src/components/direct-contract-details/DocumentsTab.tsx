import { FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props {
  contractId: number;
  contractType: string;
}

export function DocumentsTab({ contractId, contractType }: Props) {
  const { data: documents } = trpc.directContracts.documents.list.useQuery({ directContractId: contractId });
  const utils = trpc.useUtils();
  const generateDocMutation = (trpc as any).directContracts.documents.generate.useMutation();

  const handleGenerate = async (type: string) => {
    try {
      await generateDocMutation.mutateAsync({ directContractId: contractId, type });
      toast.success("Documento gerado com sucesso!");
      utils.directContracts.documents.list.invalidate({ directContractId: contractId });
    } catch (error: any) {
      toast.error(error.message || "Erro ao gerar documento");
    }
  };

  const docButtons = [
    {
      type: contractType === "dispensa" ? "termo_dispensa" : "termo_inexigibilidade",
      label: contractType === "dispensa" ? "Gerar Termo de Dispensa" : "Gerar Termo de Inexigibilidade",
    },
    { type: "minuta_contrato", label: "Gerar Minuta de Contrato" },
    { type: "planilha_cotacao", label: "Gerar Planilha de Cotação" },
    { type: "mapa_comparativo", label: "Gerar Mapa Comparativo" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentos Gerados</CardTitle>
        <CardDescription>Gere e baixe os documentos necessários para a contratação</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {docButtons.map(({ type, label }) => (
            <Button
              key={type}
              variant="outline"
              onClick={() => handleGenerate(type)}
              disabled={generateDocMutation.isPending}
            >
              <FileText className="w-4 h-4 mr-2" />
              {label}
            </Button>
          ))}
        </div>

        <Separator className="my-6" />

        {documents && documents.length > 0 ? (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="font-medium">{doc.type.replace(/_/g, " ").toUpperCase()}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Gerado em {format(new Date(doc.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                </div>
                <Button variant="ghost" size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  Baixar
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-center text-gray-600 dark:text-gray-400 py-8">
            Nenhum documento gerado ainda
          </p>
        )}
      </CardContent>
    </Card>
  );
}
