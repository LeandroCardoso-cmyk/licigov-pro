import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Loader2, Activity } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { ActivityFiltersCard } from "@/components/activity-report/ActivityFiltersCard";
import { ActivityLogCard, ACTION_LABELS } from "@/components/activity-report/ActivityLogCard";

export default function ActivityReport() {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: activities = [], isLoading } = trpc.processes.getActivityLogs.useQuery();

  const filteredActivities = activities.filter((activity: any) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!activity.description?.toLowerCase().includes(q) && !activity.userName?.toLowerCase().includes(q)) return false;
    }
    if (actionFilter !== "all" && activity.action !== actionFilter) return false;
    if (dateFrom && new Date(activity.createdAt) < new Date(dateFrom)) return false;
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      if (new Date(activity.createdAt) > end) return false;
    }
    return true;
  });

  const handleExportPDF = () => {
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Relatório de Atividades</title>
<style>
body{font-family:Arial,sans-serif;padding:40px}
h1{color:#333;border-bottom:2px solid #0066cc;padding-bottom:10px}
.meta{color:#666;margin-bottom:30px}
table{width:100%;border-collapse:collapse;margin-top:20px}
th{background:#f5f5f5;padding:12px;text-align:left;border-bottom:2px solid #ddd}
td{padding:10px;border-bottom:1px solid #eee}
.action-badge{display:inline-block;padding:4px 8px;border-radius:4px;font-size:12px}
.create{background:#d4edda;color:#155724}.update{background:#d1ecf1;color:#0c5460}
.delete{background:#f8d7da;color:#721c24}.view{background:#e2e3e5;color:#383d41}
.other{background:#e7d6f5;color:#6f42c1}
</style></head><body>
<h1>Relatório de Atividades</h1>
<div class="meta">
<p><strong>Gerado em:</strong> ${new Date().toLocaleString("pt-BR")}</p>
<p><strong>Usuário:</strong> ${user?.name || user?.email || "N/A"}</p>
<p><strong>Total de registros:</strong> ${filteredActivities.length}</p>
${searchQuery ? `<p><strong>Filtro de busca:</strong> ${searchQuery}</p>` : ""}
${actionFilter !== "all" ? `<p><strong>Filtro de ação:</strong> ${ACTION_LABELS[actionFilter]}</p>` : ""}
${dateFrom ? `<p><strong>Data inicial:</strong> ${new Date(dateFrom).toLocaleDateString("pt-BR")}</p>` : ""}
${dateTo ? `<p><strong>Data final:</strong> ${new Date(dateTo).toLocaleDateString("pt-BR")}</p>` : ""}
</div>
<table><thead><tr><th>Data/Hora</th><th>Usuário</th><th>Ação</th><th>Descrição</th></tr></thead>
<tbody>${filteredActivities.map((a: any) => `
<tr><td>${new Date(a.createdAt).toLocaleString("pt-BR")}</td>
<td>${a.userName || "Sistema"}</td>
<td><span class="action-badge ${a.action}">${ACTION_LABELS[a.action] || a.action}</span></td>
<td>${a.description || "-"}</td></tr>`).join("")}
</tbody></table></body></html>`;

    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    Object.assign(document.createElement("a"), {
      href: url,
      download: `relatorio-atividades-${new Date().toISOString().split("T")[0]}.html`,
    }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Relatório de Atividades</h1>
        <p className="text-muted-foreground mt-1">Visualize e exporte o histórico completo de atividades do sistema</p>
      </div>

      <ActivityFiltersCard
        searchQuery={searchQuery}
        actionFilter={actionFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        resultCount={filteredActivities.length}
        isExportDisabled={filteredActivities.length === 0}
        onSearchChange={setSearchQuery}
        onActionChange={setActionFilter}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        onClear={() => { setSearchQuery(""); setActionFilter("all"); setDateFrom(""); setDateTo(""); }}
        onExport={handleExportPDF}
      />

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
            <ActivityLogCard key={activity.id} activity={activity} />
          ))}
        </div>
      )}
    </div>
  );
}
