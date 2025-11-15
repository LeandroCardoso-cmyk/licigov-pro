import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, LayoutGrid, List, Calendar as CalendarIcon, BarChart3 } from "lucide-react";
import TaskKanban from "@/components/TaskKanban";
import TaskList from "@/components/TaskList";
import TaskCalendar from "@/components/TaskCalendar";
import TaskDashboard from "@/components/TaskDashboard";

export default function DepartmentManagement() {
  const [activeTab, setActiveTab] = useState("kanban");

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
        <Button size="lg">
          <Plus className="h-5 w-5 mr-2" />
          Nova Tarefa
        </Button>
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
