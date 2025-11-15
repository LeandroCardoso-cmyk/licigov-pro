import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Download, Search, Filter, FileText, Loader2, Calendar, User, Activity } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

const actionLabels: Record<string, string> = {
  create: "Criação",
  update: "Atualização",
  delete: "Exclusão",
  view: "Visualização",
  other: "Outro",
};

const actionColors: Record<string, string> = {
  create: "bg-green-500/10 text-green-700 dark:text-green-400",
  update: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  delete: "bg-red-500/10 text-red-700 dark:text-red-400",
  view: "bg-gray-500/10 text-gray-700 dark:text-gray-400",
  other: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

export default function ActivityReport() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: activities = [], isLoading } = trpc.processes.getActivityLogs.useQuery();

  // Filtrar atividades
  const filteredActivities = activities.filter((activity: any) => {
    // Filtro de busca
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        activity.description?.toLowerCase().includes(query) ||
        activity.userName?.toLowerCase().includes(query);
      if (!matchesSearch) return false;
    }

    // Filtro de ação
    if (actionFilter !== "all" && activity.action !== actionFilter) {
      return false;
    }

    // Filtro de data
    if (dateFrom) {
      const activityDate = new Date(activity.createdAt);
      const fromDate = new Date(dateFrom);
      if (activityDate < fromDate) return false;
    }

    if (dateTo) {
      const activityDate = new Date(activity.createdAt);
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999); // Fim do dia
      if (activityDate > toDate) return false;
    }

    return true;
  });

  const handleExportPDF = async () => {
    try {
      toast.info("Gerando PDF...");
      
      // Criar HTML para PDF
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Relatório de Atividades</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; }
            h1 { color: #333; border-bottom: 2px solid #0066cc; padding-bottom: 10px; }
            .meta { color: #666; margin-bottom: 30px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th { background: #f5f5f5; padding: 12px; text-align: left; border-bottom: 2px solid #ddd; }
            td { padding: 10px; border-bottom: 1px solid #eee; }
            .action-badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; }
            .create { background: #d4edda; color: #155724; }
            .update { background: #d1ecf1; color: #0c5460; }
            .delete { background: #f8d7da; color: #721c24; }
            .view { background: #e2e3e5; color: #383d41; }
            .other { background: #e7d6f5; color: #6f42c1; }
          </style>
        </head>
        <body>
          <h1>Relatório de Atividades</h1>
          <div class="meta">
            <p><strong>Gerado em:</strong> ${new Date().toLocaleString("pt-BR")}</p>
            <p><strong>Usuário:</strong> ${user?.name || user?.email || "N/A"}</p>
            <p><strong>Total de registros:</strong> ${filteredActivities.length}</p>
            ${searchQuery ? `<p><strong>Filtro de busca:</strong> ${searchQuery}</p>` : ""}
            ${actionFilter !== "all" ? `<p><strong>Filtro de ação:</strong> ${actionLabels[actionFilter]}</p>` : ""}
            ${dateFrom ? `<p><strong>Data inicial:</strong> ${new Date(dateFrom).toLocaleDateString("pt-BR")}</p>` : ""}
            ${dateTo ? `<p><strong>Data final:</strong> ${new Date(dateTo).toLocaleDateString("pt-BR")}</p>` : ""}
          </div>
          <table>
            <thead>
              <tr>
                <th>Data/Hora</th>
                <th>Usuário</th>
                <th>Ação</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              ${filteredActivities
                .map(
                  (activity: any) => `
                <tr>
                  <td>${new Date(activity.createdAt).toLocaleString("pt-BR")}</td>
                  <td>${activity.userName || "Sistema"}</td>
                  <td><span class="action-badge ${activity.action}">${actionLabels[activity.action] || activity.action}</span></td>
                  <td>${activity.description || "-"}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        </body>
        </html>
      `;

      // Criar blob e download
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `relatorio-atividades-${new Date().toISOString().split("T")[0]}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Relatório exportado! Abra o arquivo HTML em um navegador e use Ctrl+P para salvar como PDF.");
    } catch (error) {
      console.error("Erro ao exportar:", error);
      toast.error("Erro ao exportar relatório");
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setActionFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Relatório de Atividades</h1>
        <p className="text-muted-foreground mt-1">
          Visualize e exporte o histórico completo de atividades do sistema
        </p>
      </div>

      {/* Filtros */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filtros
          </CardTitle>
          <CardDescription>
            Refine sua busca usando os filtros abaixo
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="search">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="search"
                  placeholder="Buscar por descrição ou usuário..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="action">Tipo de Ação</Label>
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger id="action">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as ações</SelectItem>
                  {Object.entries(actionLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="dateFrom">Data Inicial</Label>
              <Input
                id="dateFrom"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="dateTo">Data Final</Label>
              <Input
                id="dateTo"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              {filteredActivities.length} {filteredActivities.length === 1 ? "registro encontrado" : "registros encontrados"}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Limpar Filtros
              </Button>
              <Button size="sm" onClick={handleExportPDF} disabled={filteredActivities.length === 0}>
                <Download className="mr-2 h-4 w-4" />
                Exportar PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista de Atividades */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredActivities.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Activity className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">Nenhuma atividade encontrada</p>
            <p className="text-sm text-muted-foreground">
              {activities.length === 0
                ? "Ainda não há atividades registradas no sistema"
                : "Tente ajustar os filtros para encontrar o que procura"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredActivities.map((activity: any) => (
            <Card key={activity.id}>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Badge className={actionColors[activity.action] || actionColors.other}>
                        {actionLabels[activity.action] || activity.action}
                      </Badge>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        {new Date(activity.createdAt).toLocaleString("pt-BR")}
                      </div>
                      {activity.userName && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <User className="h-4 w-4" />
                          {activity.userName}
                        </div>
                      )}
                    </div>
                    <p className="text-sm">{activity.description || "Sem descrição"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
