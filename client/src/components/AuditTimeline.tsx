import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  FileText,
  Edit,
  Download,
  Plus,
  Trash2,
  Package,
  CheckCircle2,
  Send,
  CheckSquare,
  Clock,
  User,
  FileDown,
} from "lucide-react";

interface AuditTimelineProps {
  contractId: number;
}

/**
 * Componente de Timeline de Auditoria
 * Exibe histórico completo de ações realizadas na contratação direta
 */
export function AuditTimeline({ contractId }: AuditTimelineProps) {
  const [filterAction, setFilterAction] = useState<string>("all");

  // Query para buscar logs
  const { data: logs, isLoading } = trpc.directContracts.audit.getLogs.useQuery({
    contractId,
  });

  // Mutation para exportar relatório
  const exportReportMutation = trpc.directContracts.audit.exportReport.useMutation();

  const handleExportPDF = async () => {
    try {
      const result = await exportReportMutation.mutateAsync({
        contractId,
        filterAction: filterAction === "all" ? undefined : filterAction,
      });

      // Converter base64 para blob e fazer download
      const byteCharacters = atob(result.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/pdf" });

      // Criar link de download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Erro ao exportar relatório:", error);
    }
  };

  const getActionIcon = (action: string) => {
    switch (action) {
      case "created":
        return <Plus className="w-5 h-5 text-green-600" />;
      case "updated":
        return <Edit className="w-5 h-5 text-blue-600" />;
      case "status_changed":
        return <CheckCircle2 className="w-5 h-5 text-purple-600" />;
      case "document_generated":
        return <FileText className="w-5 h-5 text-indigo-600" />;
      case "document_downloaded":
        return <Download className="w-5 h-5 text-gray-600" />;
      case "quotation_added":
        return <Plus className="w-5 h-5 text-emerald-600" />;
      case "quotation_deleted":
        return <Trash2 className="w-5 h-5 text-red-600" />;
      case "package_generated":
        return <Package className="w-5 h-5 text-orange-600" />;
      case "checklist_updated":
        return <CheckSquare className="w-5 h-5 text-teal-600" />;
      case "approved":
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case "published":
        return <Send className="w-5 h-5 text-blue-600" />;
      case "ratified":
        return <CheckCircle2 className="w-5 h-5 text-purple-600" />;
      case "completed":
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      default:
        return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

  const getActionLabel = (action: string) => {
    const labels: Record<string, string> = {
      created: "Contratação Criada",
      updated: "Contratação Editada",
      status_changed: "Status Alterado",
      document_generated: "Documento Gerado",
      document_downloaded: "Documento Baixado",
      quotation_added: "Cotação Adicionada",
      quotation_deleted: "Cotação Removida",
      package_generated: "Pacote Presencial Gerado",
      checklist_updated: "Checklist Atualizado",
      approved: "Contratação Aprovada",
      published: "Contratação Publicada",
      ratified: "Contratação Ratificada",
      completed: "Contratação Concluída",
    };
    return labels[action] || action;
  };

  const getActionColor = (action: string) => {
    switch (action) {
      case "created":
      case "approved":
      case "completed":
        return "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200";
      case "updated":
      case "published":
        return "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200";
      case "document_generated":
        return "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200";
      case "quotation_added":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200";
      case "quotation_deleted":
        return "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200";
      case "package_generated":
        return "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200";
      case "status_changed":
      case "ratified":
        return "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-gray-600 dark:text-gray-400">Carregando histórico...</p>
        </CardContent>
      </Card>
    );
  }

  if (!logs || logs.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-gray-600 dark:text-gray-400">Nenhuma ação registrada ainda</p>
        </CardContent>
      </Card>
    );
  }

  // Filtrar logs por ação
  const filteredLogs = filterAction === "all" ? logs : logs.filter((log) => log.action === filterAction);

  return (
    <div className="space-y-6">
      {/* Header com filtro */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
          <div>
            <CardTitle>Histórico de Ações</CardTitle>
            <CardDescription>Registro completo de todas as ações realizadas</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <Select value={filterAction} onValueChange={setFilterAction}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Filtrar por ação" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Ações</SelectItem>
                <SelectItem value="created">Criação</SelectItem>
                <SelectItem value="updated">Edição</SelectItem>
                <SelectItem value="document_generated">Documentos Gerados</SelectItem>
                <SelectItem value="quotation_added">Cotações Adicionadas</SelectItem>
                <SelectItem value="package_generated">Pacotes Gerados</SelectItem>
                <SelectItem value="status_changed">Mudanças de Status</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleExportPDF}
              disabled={exportReportMutation.isPending}
              variant="outline"
            >
              <FileDown className="w-4 h-4 mr-2" />
              {exportReportMutation.isPending ? "Gerando..." : "Exportar PDF"}
            </Button>
          </div>
          </div>
        </CardHeader>
      </Card>

      {/* Timeline */}
      <div className="relative space-y-4">
        {/* Linha vertical */}
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />

        {filteredLogs.map((log, index) => (
          <Card key={log.id} className="relative ml-14">
            {/* Ícone */}
            <div className="absolute -left-14 top-6 w-12 h-12 rounded-full bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 flex items-center justify-center">
              {getActionIcon(log.action)}
            </div>

            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge className={getActionColor(log.action)}>{getActionLabel(log.action)}</Badge>
                    {log.details && typeof log.details === "object" && "documentType" in log.details && (
                      <Badge variant="outline">{(log.details as any).documentType}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                    <User className="w-4 h-4" />
                    <span>{log.userName || "Sistema"}</span>
                    <span>•</span>
                    <Clock className="w-4 h-4" />
                    <span>{format(new Date(log.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</span>
                  </div>
                </div>
              </div>
            </CardHeader>

            {/* Detalhes da ação */}
            {log.details && typeof log.details === "object" && Object.keys(log.details).length > 0 && (
              <CardContent>
                <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md">
                  <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                </div>
              </CardContent>
            )}
          </Card>
        ))}
      </div>

      {filteredLogs.length === 0 && (
        <Card>
          <CardContent className="py-8">
            <p className="text-center text-gray-600 dark:text-gray-400">
              Nenhuma ação encontrada para o filtro selecionado
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
