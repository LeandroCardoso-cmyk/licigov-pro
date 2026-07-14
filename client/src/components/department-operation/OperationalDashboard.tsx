import React from "react";
import { trpc } from "../../lib/trpc";
import OperationalIndicators from "./OperationalIndicators";
import { EVENT_TYPE_LABELS, EVENT_TYPE_CLASSES, formatDate } from "./labels";

/**
 * OperationalDashboard — REAL (tRPC).
 *
 * ÁREA 1 — Centro de Operações: "como está o departamento agora?". Indicadores +
 * eventos de hoje e futuros, consolidados automaticamente dos Business Domains.
 */

export interface OperationalDashboardProps { onOpenReference?: (type: string, id: string) => void }

function EventList({ title, events, empty, onOpen }: { title: string; events: Array<{ id: string; eventType: string; title: string; eventDate: string; eventTime: string; referenceType: string; referenceId: string }>; empty: string; onOpen?: (t: string, i: string) => void }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">{title}</h3>
      {events.length === 0 ? (
        <p className="text-xs text-gray-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => e.referenceId && onOpen?.(e.referenceType, e.referenceId)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-gray-50">
                <div className="min-w-0">
                  <p className="line-clamp-1 text-sm text-gray-800">{e.title}</p>
                  <p className="text-xs text-gray-400">{formatDate(e.eventDate)}{e.eventTime ? ` · ${e.eventTime}` : ""}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${EVENT_TYPE_CLASSES[e.eventType] ?? "bg-gray-100 text-gray-700"}`}>{EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function OperationalDashboard({ onOpenReference }: OperationalDashboardProps) {
  const { data, isLoading } = trpc.departmentOperation.dashboard.useQuery({});

  return (
    <div className="space-y-5">
      <OperationalIndicators />
      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-gray-100" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <EventList title="Eventos de hoje" events={data?.todayEvents ?? []} empty="Nenhum evento hoje." onOpen={onOpenReference} />
          <EventList title="Próximos eventos" events={data?.upcomingEvents ?? []} empty="Nenhum evento futuro." onOpen={onOpenReference} />
        </div>
      )}
    </div>
  );
}
