import React from "react";
import { useLocation } from "wouter";
import { PageShell } from "@/components/ui/PageHeader";
import { trpc } from "@/lib/trpc";
import OperationalIndicators from "@/components/department-operation/OperationalIndicators";
import { EVENT_TYPE_LABELS, EVENT_TYPE_CLASSES, formatDate } from "@/components/department-operation/labels";
import { LayoutDashboard, Gauge, FileText, FileCheck, Scale, ScrollText, HelpCircle, ArrowRight, CalendarClock } from "lucide-react";

/**
 * Dashboard — visão geral EXECUTIVA do departamento (V1 UI/UX Stabilization).
 *
 * Distinção institucional em relação ao Centro de Operações:
 *  - Dashboard      → LEITURA de alto nível: indicadores consolidados, próximos
 *                     compromissos e atalhos. Uma tela, sem abas, sem ação.
 *  - Centro de Op.  → WORKSPACE operacional (Minha Caixa/pendências, painel,
 *                     calendário, timeline, registros) — é lá que se AGE.
 *
 * Usa SOMENTE dados/endpoints já existentes (departmentOperation.indicators e
 * departmentOperation.dashboard). NÃO cria backend, capacidade nem dado novo — os
 * atalhos são navegação de front-end (wouter). Tokens semânticos (dark-mode-safe).
 */

const SHORTCUTS: Array<{ icon: typeof Gauge; label: string; desc: string; path: string }> = [
  { icon: Gauge, label: "Centro de Operações", desc: "Pendências, painel, calendário e caixa", path: "/centro-operacoes" },
  { icon: FileText, label: "Processo Licitatório", desc: "DFD → ETP → TR → Edital", path: "/processos" },
  { icon: FileCheck, label: "Contratação Direta", desc: "Dispensa, inexigibilidade, credenciamento", path: "/contratacao-direta" },
  { icon: Scale, label: "Parecer Jurídico", desc: "Caixa institucional e elaboração", path: "/parecer" },
  { icon: ScrollText, label: "Contratos", desc: "Contratos e aditivos", path: "/contratos" },
  { icon: HelpCircle, label: "Tirar Dúvidas", desc: "Apoio sobre a Lei 14.133/2021", path: "/tirar-duvidas" },
];

/**
 * Snapshot de próximos compromissos — LEITURA do mesmo endpoint do Centro
 * (departmentOperation.dashboard). Compacto e read-only; a ação continua no Centro.
 */
function UpcomingEvents() {
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.departmentOperation.dashboard.useQuery({});
  const events = (data?.upcomingEvents ?? []).slice(0, 6);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarClock className="h-4 w-4 text-muted-foreground" /> Próximos compromissos
        </h2>
        <button
          type="button"
          onClick={() => navigate("/centro-operacoes")}
          className="text-xs font-medium text-primary hover:underline"
        >
          Ver no Centro de Operações
        </button>
      </div>
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      ) : events.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhum compromisso futuro registrado.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
              <div className="min-w-0">
                <p className="line-clamp-1 text-sm text-foreground">{e.title}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(e.eventDate)}{e.eventTime ? ` · ${e.eventTime}` : ""}
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${EVENT_TYPE_CLASSES[e.eventType] ?? "bg-muted text-foreground"}`}>
                {EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ExecutiveDashboard() {
  const [, navigate] = useLocation();

  return (
    <PageShell
      icon={LayoutDashboard}
      breadcrumbs={[{ label: "Dashboard" }]}
      title="Dashboard"
      description="Visão geral do departamento — indicadores, próximos compromissos e atalhos. Para agir sobre pendências, use o Centro de Operações."
    >
      <div className="space-y-8">
        <section>
          <h2 className="mb-3 text-sm font-semibold text-foreground">Situação geral</h2>
          <OperationalIndicators />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <UpcomingEvents />

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Atalhos</h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SHORTCUTS.map((s) => (
                <button
                  key={s.path}
                  type="button"
                  onClick={() => navigate(s.path)}
                  className="group flex items-start gap-3 rounded-lg border border-border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-muted"
                >
                  <span className="rounded-md bg-primary/10 p-2 text-primary">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                      {s.label}
                      <ArrowRight className="h-3 w-3 opacity-0 transition group-hover:opacity-100" />
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{s.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </PageShell>
  );
}
