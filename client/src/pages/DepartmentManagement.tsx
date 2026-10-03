import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, LayoutGrid, List, Calendar as CalendarIcon, BarChart3, Download, FileSpreadsheet, Bell } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import TaskKanban from "@/components/TaskKanban";
import TaskList from "@/components/TaskList";
import TaskCalendar from "@/components/TaskCalendar";
import TaskDashboard from "@/components/TaskDashboard";

/**
 * Classes de botão desabilitado (padrão do design system, sem `opacity-50`): `disabled:opacity-100` neutraliza,
 * via tailwind-merge, o `disabled:opacity-50` da base do <Button>.
 */
const DISABLED_BUTTON_CLASSES = "disabled:opacity-100 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground";

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

export default function DepartmentManagement() {
  const [activeTab, setActiveTab] = useState("kanban");

  // R9 / SEM-071 — as exportações existem em `tasks.*` (taskRouter). Antes os botões chamavam
  // `departmentTasks.exportExcel/exportPDF/checkDeadlines` (inexistentes) via `(trpc as any)`.
  const exportExcelMutation = trpc.tasks.exportExcel.useMutation({
    onSuccess: (data) => {
      const byteCharacters = atob(data.data);
      const byteArray = new Uint8Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteArray[i] = byteCharacters.charCodeAt(i);
      }
      downloadBlob(
        new Blob([byteArray], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        data.filename,
      );
      toast.success("Relatório Excel exportado com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao exportar relatório", { description: error.message });
    },
  });

  // Relatório resumido: o servidor gera MARKDOWN (.md) — o rótulo diz isso (não é um PDF).
  const exportSummaryMutation = trpc.tasks.exportPDF.useMutation({
    onSuccess: (data) => {
      downloadBlob(new Blob([data.content], { type: "text/markdown" }), data.filename);
      toast.success("Resumo (Markdown) exportado com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao exportar relatório", { description: error.message });
    },
  });

  const checkDeadlinesMutation = trpc.tasks.checkDeadlines.useMutation({
    onSuccess: (result) => {
      if (result.success && "upcomingCount" in result) {
        toast.success(`Verificação concluída!`, {
          description: `${result.notificationsSent} notificação(s) enviada(s). ${result.upcomingCount} tarefa(s) próximas do prazo, ${result.overdueCount} atrasada(s).`,
        });
      } else {
        toast.error("Erro ao verificar prazos");
      }
    },
    onError: (error) => {
      toast.error("Erro ao verificar prazos", { description: error.message });
    },
  });

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Gestão do Departamento</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie tarefas, prazos e atividades do departamento de licitações
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => checkDeadlinesMutation.mutate()}
            disabled={checkDeadlinesMutation.isPending}
            className={DISABLED_BUTTON_CLASSES}
          >
            <Bell className="h-4 w-4 mr-2" />
            {checkDeadlinesMutation.isPending ? "Verificando..." : "Verificar Prazos"}
          </Button>
          <Button
            variant="outline"
            onClick={() => exportSummaryMutation.mutate()}
            disabled={exportSummaryMutation.isPending}
            className={DISABLED_BUTTON_CLASSES}
          >
            <Download className="h-4 w-4 mr-2" />
            {exportSummaryMutation.isPending ? "Exportando..." : "Resumo (Markdown)"}
          </Button>
          <Button
            variant="outline"
            onClick={() => exportExcelMutation.mutate()}
            disabled={exportExcelMutation.isPending}
            className={DISABLED_BUTTON_CLASSES}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            {exportExcelMutation.isPending ? "Exportando..." : "Excel Completo"}
          </Button>
          {/* R9 / SEM-071 — não há formulário de criação nesta tela: botão desabilitado com rótulo honesto. */}
          <Button size="lg" disabled className={DISABLED_BUTTON_CLASSES} title="Cadastro de tarefas por esta tela ainda não disponível">
            <Plus className="h-5 w-5 mr-2" />
            Nova Tarefa (indisponível)
          </Button>
        </div>
      </div>

      {/* Tabs de visualização */}
      <Tabs defaultValue="kanban" value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-4">
          <TabsTrigger value="kanban" className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4" />
            <span className="hidden sm:inline">Kanban</span>
          </TabsTrigger>
          <TabsTrigger value="list" className="flex items-center gap-2">
            <List className="h-4 w-4" />
            <span className="hidden sm:inline">Lista</span>
          </TabsTrigger>
          <TabsTrigger value="calendar" className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Calendário</span>
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="kanban" className="mt-6">
          <TaskKanban />
        </TabsContent>

        <TabsContent value="list" className="mt-6">
          <TaskList />
        </TabsContent>

        <TabsContent value="calendar" className="mt-6">
          <TaskCalendar />
        </TabsContent>

        <TabsContent value="dashboard" className="mt-6">
          <TaskDashboard />
        </TabsContent>
      </Tabs>
    </div>
  );
}
