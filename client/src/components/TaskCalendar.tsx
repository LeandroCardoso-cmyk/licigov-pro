import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  isToday,
} from "date-fns";
import { ptBR } from "date-fns/locale";

const PRIORITY_COLORS = {
  baixa: "bg-gray-100 text-gray-700 border-gray-300",
  media: "bg-blue-100 text-blue-700 border-blue-300",
  alta: "bg-orange-100 text-orange-700 border-orange-300",
  urgente: "bg-red-100 text-red-700 border-red-300",
};

export default function TaskCalendar() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  const { data: tasks = [], isLoading } = trpc.departmentTasks.list.useQuery();

  // Calcular dias do calendário (incluindo dias do mês anterior e próximo)
  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart, { locale: ptBR });
    const calendarEnd = endOfWeek(monthEnd, { locale: ptBR });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentMonth]);

  // Agrupar tarefas por data de prazo
  const tasksByDate = useMemo(() => {
    const grouped: Record<string, typeof tasks> = {};
    
    tasks.forEach((task) => {
      if (task.deadline) {
        const dateKey = format(new Date(task.deadline), "yyyy-MM-dd");
        if (!grouped[dateKey]) {
          grouped[dateKey] = [];
        }
        grouped[dateKey].push(task);
      }
    });

    return grouped;
  }, [tasks]);

  const previousMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const goToToday = () => setCurrentMonth(new Date());

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-96">
            <div className="text-muted-foreground">Carregando calendário...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header do Calendário */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              {format(currentMonth, "MMMM 'de' yyyy", { locale: ptBR })}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={goToToday}>
                Hoje
              </Button>
              <Button variant="outline" size="icon" onClick={previousMonth}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={nextMonth}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Grid do Calendário */}
          <div className="grid grid-cols-7 gap-2">
            {/* Cabeçalho dos dias da semana */}
            {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => (
              <div
                key={day}
                className="text-center text-sm font-semibold text-muted-foreground py-2"
              >
                {day}
              </div>
            ))}

            {/* Dias do mês */}
            {calendarDays.map((day, idx) => {
              const dateKey = format(day, "yyyy-MM-dd");
              const dayTasks = tasksByDate[dateKey] || [];
              const isCurrentMonth = isSameMonth(day, currentMonth);
              const isTodayDate = isToday(day);

              return (
                <div
                  key={idx}
                  className={`
                    min-h-[120px] border rounded-lg p-2 space-y-1
                    ${!isCurrentMonth ? "bg-muted/30" : "bg-background"}
                    ${isTodayDate ? "ring-2 ring-primary" : ""}
                  `}
                >
                  {/* Número do dia */}
                  <div
                    className={`
                      text-sm font-medium text-center mb-1
                      ${!isCurrentMonth ? "text-muted-foreground" : ""}
                      ${isTodayDate ? "text-primary font-bold" : ""}
                    `}
                  >
                    {format(day, "d")}
                  </div>

                  {/* Tarefas do dia */}
                  <div className="space-y-1">
                    {dayTasks.slice(0, 3).map((task) => (
                      <div
                        key={task.id}
                        className={`
                          text-xs p-1 rounded border cursor-pointer
                          hover:shadow-sm transition-shadow
                          ${PRIORITY_COLORS[task.priority]}
                        `}
                        title={`${task.title}\n${task.description || ""}\nPrioridade: ${task.priority}\nStatus: ${task.status}`}
                      >
                        <div className="font-medium truncate">{task.title}</div>
                      </div>
                    ))}
                    {dayTasks.length > 3 && (
                      <div className="text-xs text-muted-foreground text-center">
                        +{dayTasks.length - 3} mais
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Legenda */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Legenda de Prioridades</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border bg-gray-100 border-gray-300" />
              <span className="text-sm">Baixa</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border bg-blue-100 border-blue-300" />
              <span className="text-sm">Média</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border bg-orange-100 border-orange-300" />
              <span className="text-sm">Alta</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded border bg-red-100 border-red-300" />
              <span className="text-sm">Urgente</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estatísticas do mês */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Resumo do Mês</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-primary">
                {tasks.filter((t) => {
                  if (!t.deadline) return false;
                  return isSameMonth(new Date(t.deadline), currentMonth);
                }).length}
              </div>
              <div className="text-sm text-muted-foreground">Tarefas no mês</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {tasks.filter((t) => {
                  if (!t.deadline) return false;
                  return isSameMonth(new Date(t.deadline), currentMonth) && t.status === "concluida";
                }).length}
              </div>
              <div className="text-sm text-muted-foreground">Concluídas</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {tasks.filter((t) => {
                  if (!t.deadline) return false;
                  return isSameMonth(new Date(t.deadline), currentMonth) && 
                         ["pendente", "em_andamento", "pausada"].includes(t.status);
                }).length}
              </div>
              <div className="text-sm text-muted-foreground">Em andamento</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {tasks.filter((t) => {
                  if (!t.deadline) return false;
                  return isSameMonth(new Date(t.deadline), currentMonth) && t.status === "atrasada";
                }).length}
              </div>
              <div className="text-sm text-muted-foreground">Atrasadas</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
