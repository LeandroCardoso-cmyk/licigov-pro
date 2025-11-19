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

export default function DepartmentManagement() {
  const [activeTab, setActiveTab] = useState("kanban");
  
  // Mutation para exportar Excel
  const exportExcelMutation = trpc.departmentTasks.exportExcel.useMutation({
    onSuccess: (data) => {
      const byteCharacters = atob(data.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success("Relatório Excel exportado com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao exportar relatório", {
        description: error.message,
      });
    },
  });
  
  // Mutation para exportar PDF (Markdown)
  const exportPDFMutation = trpc.departmentTasks.exportPDF.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.content], { type: "text/markdown" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success("Relatório resumido exportado com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao exportar relatório", {
        description: error.message,
      });
    },
  });
  
  // Mutation para verificar prazos
  const checkDeadlinesMutation = trpc.departmentTasks.checkDeadlines.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Verificação concluída!`, {
          description: `${result.notificationsSent} notificação(s) enviada(s). ${result.upcomingCount} tarefa(s) próximas do prazo, ${result.overdueCount} atrasada(s).`,
        });
      } else {
        toast.error("Erro ao verificar prazos");
      }
    },
    onError: (error) => {      toast.error("Erro ao verificar prazos", {
        description: error.message,
      });
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
          >
            <Bell className="h-4 w-4 mr-2" />
            {checkDeadlinesMutation.isPending ? "Verificando..." : "Verificar Prazos"}
          </Button>
          <Button
            variant="outline"
            onClick={() => exportPDFMutation.mutate()}
            disabled={exportPDFMutation.isPending}
          >
            <Download className="h-4 w-4 mr-2" />
            {exportPDFMutation.isPending ? "Exportando..." : "PDF Resumido"}
          </Button>
          <Button
            variant="outline"
            onClick={() => exportExcelMutation.mutate()}
            disabled={exportExcelMutation.isPending}
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            {exportExcelMutation.isPending ? "Exportando..." : "Excel Completo"}
          </Button>
          <Button size="lg">
            <Plus className="h-5 w-5 mr-2" />
            Nova Tarefa
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
