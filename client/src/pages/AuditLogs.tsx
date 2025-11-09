import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Download, ArrowLeft, Search, Filter } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const actionLabels: Record<string, string> = {
  user_promoted: "Usuário Promovido",
  user_demoted: "Usuário Rebaixado",
  member_added: "Membro Adicionado",
  member_removed: "Membro Removido",
  permission_changed: "Permissão Alterada",
  document_created: "Documento Criado",
  document_updated: "Documento Atualizado",
  document_deleted: "Documento Deletado",
  process_created: "Processo Criado",
  process_updated: "Processo Atualizado",
  process_deleted: "Processo Deletado",
  comment_added: "Comentário Adicionado",
  comment_deleted: "Comentário Deletado",
};

const actionColors: Record<string, string> = {
  user_promoted: "bg-green-500/10 text-green-500",
  user_demoted: "bg-orange-500/10 text-orange-500",
  member_added: "bg-blue-500/10 text-blue-500",
  member_removed: "bg-red-500/10 text-red-500",
  permission_changed: "bg-purple-500/10 text-purple-500",
  document_created: "bg-green-500/10 text-green-500",
  document_updated: "bg-blue-500/10 text-blue-500",
  document_deleted: "bg-red-500/10 text-red-500",
  process_created: "bg-green-500/10 text-green-500",
  process_updated: "bg-blue-500/10 text-blue-500",
  process_deleted: "bg-red-500/10 text-red-500",
  comment_added: "bg-blue-500/10 text-blue-500",
  comment_deleted: "bg-red-500/10 text-red-500",
};

export default function AuditLogs() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data: logs, isLoading } = trpc.admin.getAuditLogs.useQuery({
    action: actionFilter === "all" ? undefined : actionFilter,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  });

  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>Apenas administradores podem acessar esta página</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setLocation("/")} className="w-full">
              Voltar para Início
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filteredLogs = logs?.filter((log) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      log.userName?.toLowerCase().includes(query) ||
      log.userEmail?.toLowerCase().includes(query) ||
      log.details?.toLowerCase().includes(query)
    );
  });

  const handleExportCSV = () => {
    if (!filteredLogs || filteredLogs.length === 0) {
      toast.error("Nenhum log para exportar");
      return;
    }

    const headers = ["Data/Hora", "Usuário", "Email", "Ação", "Detalhes", "IP"];
    const rows = filteredLogs.map((log) => [
      format(new Date(log.createdAt), "dd/MM/yyyy HH:mm:ss", { locale: ptBR }),
      log.userName || "",
      log.userEmail || "",
      actionLabels[log.action] || log.action,
      log.details || "",
      log.ipAddress || "",
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `audit-logs-${format(new Date(), "yyyy-MM-dd-HHmmss")}.csv`;
    link.click();

    toast.success("Logs exportados com sucesso!");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <Button variant="ghost" onClick={() => setLocation("/admin")} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Logs de Auditoria</h1>
          <p className="text-muted-foreground">
            Histórico completo de ações administrativas e atividades do sistema
          </p>
        </div>

        {/* Filtros */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filtros
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="action-filter">Tipo de Ação</Label>
                <Select value={actionFilter} onValueChange={setActionFilter}>
                  <SelectTrigger id="action-filter">
                    <SelectValue placeholder="Todas as ações" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as ações</SelectItem>
                    <SelectItem value="user_promoted">Usuário Promovido</SelectItem>
                    <SelectItem value="user_demoted">Usuário Rebaixado</SelectItem>
                    <SelectItem value="member_added">Membro Adicionado</SelectItem>
                    <SelectItem value="member_removed">Membro Removido</SelectItem>
                    <SelectItem value="permission_changed">Permissão Alterada</SelectItem>
                    <SelectItem value="document_created">Documento Criado</SelectItem>
                    <SelectItem value="document_updated">Documento Atualizado</SelectItem>
                    <SelectItem value="document_deleted">Documento Deletado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="search">Buscar</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="search"
                    placeholder="Usuário, email ou detalhes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="start-date">Data Início</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="end-date">Data Fim</Label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-between items-center mt-4">
              <p className="text-sm text-muted-foreground">
                {filteredLogs?.length || 0} log(s) encontrado(s)
              </p>
              <Button onClick={handleExportCSV} variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Lista de Logs */}
        <Card>
          <CardHeader>
            <CardTitle>Histórico de Atividades</CardTitle>
            <CardDescription>Ordenado por mais recente</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {filteredLogs?.map((log) => (
                <div key={log.id} className="border-b pb-4 last:border-b-0">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Badge className={actionColors[log.action] || "bg-gray-500/10 text-gray-500"}>
                        {actionLabels[log.action] || log.action}
                      </Badge>
                      <div>
                        <div className="font-medium">{log.userName || "Usuário Desconhecido"}</div>
                        <div className="text-sm text-muted-foreground">{log.userEmail || "Email não disponível"}</div>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground text-right">
                      <div>{format(new Date(log.createdAt), "dd/MM/yyyy", { locale: ptBR })}</div>
                      <div>{format(new Date(log.createdAt), "HH:mm:ss", { locale: ptBR })}</div>
                    </div>
                  </div>
                  {log.details && (
                    <div className="text-sm text-muted-foreground mt-2 pl-3 border-l-2 border-muted">
                      {log.details}
                    </div>
                  )}
                  {log.ipAddress && (
                    <div className="text-xs text-muted-foreground mt-2">
                      IP: {log.ipAddress}
                    </div>
                  )}
                </div>
              ))}
              {filteredLogs?.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  Nenhum log encontrado com os filtros aplicados
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
