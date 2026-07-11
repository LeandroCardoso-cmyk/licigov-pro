import React from "react";
import { formatDateTime } from "./labels";

/**
 * TimelinePanel — PRESENTATIONAL.
 *
 * Linha do tempo da solicitação institucional (append-only). Mostra o trânsito
 * origem → parecer jurídico. Nada é editado ou removido — rastreabilidade obrigatória.
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

export interface TimelinePanelProps {
  timeline?: TimelineEvent[];
}

const MOCK: TimelineEvent[] = [
  { id: "e1", order: 1, eventType: "created", actor: "Licitações", summary: "Solicitação de parecer criada.", refId: "", createdAt: new Date().toISOString() },
  { id: "e2", order: 2, eventType: "received", actor: "Procurador", summary: "Recebida pela caixa institucional do jurídico.", refId: "", createdAt: new Date().toISOString() },
];

export default function TimelinePanel({ timeline = MOCK }: TimelinePanelProps) {
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
                <span className="text-xs font-semibold text-indigo-700">{ev.eventType}</span>
                <span className="text-[11px] text-gray-400">{formatDateTime(ev.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-800">{ev.summary}</p>
              <p className="text-xs text-gray-500">por {ev.actor}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
