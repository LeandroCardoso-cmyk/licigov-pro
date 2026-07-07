import React from "react";
import { formatDate } from "./RequestCard";

/**
 * RequestTimeline — PRESENTATIONAL.
 *
 * Linha do tempo append-only (apenas acréscimo) de uma solicitação. Registra
 * cada evento do trânsito institucional em ordem cronológica. Nada é editado
 * ou removido — a rastreabilidade é obrigatória.
 */

export interface TimelineEvent {
  id: string;
  order: number;
  eventType: string;
  actor: string;
  summary: string;
  refId: string;
  createdAt: string;
}

export interface RequestTimelineProps {
  timeline?: TimelineEvent[];
}

const EVENT_LABELS: Record<string, string> = {
  CREATED: "Criada",
  ASSIGNED: "Distribuída",
  RECEIVED: "Recebida",
  IN_PROGRESS: "Em andamento",
  RESPONDED: "Respondida",
  RETURNED: "Devolvida",
  ARCHIVED: "Arquivada",
  DOCUMENT_REFERENCED: "Documento referenciado",
};

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const MOCK_TIMELINE: TimelineEvent[] = [
  {
    id: "ev-1",
    order: 1,
    eventType: "CREATED",
    actor: "Setor de Licitações",
    summary: "Solicitação de parecer inicial criada e encaminhada.",
    refId: "req-0001",
    createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  },
  {
    id: "ev-2",
    order: 2,
    eventType: "RECEIVED",
    actor: "Assessoria Jurídica",
    summary: "Solicitação recebida pela caixa institucional do jurídico.",
    refId: "req-0001",
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
  },
  {
    id: "ev-3",
    order: 3,
    eventType: "IN_PROGRESS",
    actor: "Dra. Helena Prado",
    summary: "Análise iniciada com base nas referências documentais.",
    refId: "req-0001",
    createdAt: new Date(Date.now() - 1 * 3600_000).toISOString(),
  },
];

export default function RequestTimeline({ timeline = MOCK_TIMELINE }: RequestTimelineProps) {
  const ordered = [...timeline].sort((a, b) => a.order - b.order);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Linha do tempo</h3>
      <p className="mb-4 text-xs text-gray-400">Registro append-only — cada evento é imutável.</p>

      {ordered.length === 0 ? (
        <p className="text-xs text-gray-400">Sem eventos registrados.</p>
      ) : (
        <ol className="relative space-y-5 border-l border-gray-200 pl-5">
          {ordered.map((ev) => (
            <li key={ev.id} className="relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-500" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-indigo-700">{eventLabel(ev.eventType)}</span>
                <span className="text-[11px] text-gray-400">{formatDateTime(ev.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-800">{ev.summary}</p>
              <p className="text-xs text-gray-500">
                por {ev.actor}
                {ev.refId ? ` · ref. ${ev.refId}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-[11px] text-gray-300">
        Atualizado em {formatDate(new Date().toISOString())}
      </p>
    </div>
  );
}
