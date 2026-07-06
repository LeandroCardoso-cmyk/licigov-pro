import React from "react";

/**
 * TimelinePanel — PRESENTATIONAL.
 *
 * UX: linha do tempo append-only (rastreabilidade obrigatória). Cada evento é
 * imutável; a leitura reforça que o histórico do processo nunca é reescrito.
 */

export type TimelineEvent = {
  id: string;
  order: number;
  eventType: string;
  actor: string;
  summary: string;
  createdAt: string;
};

const DEFAULT_TIMELINE: TimelineEvent[] = [
  {
    id: "evt-1",
    order: 1,
    eventType: "workspace_created",
    actor: "maria.souza",
    summary: "Processo 2026/0001 criado (início: criar_dfd).",
    createdAt: "2026-07-01T09:00:00.000Z",
  },
  {
    id: "evt-2",
    order: 2,
    eventType: "change",
    actor: "multi_copilot",
    summary: "DFD importado (ofício).",
    createdAt: "2026-07-01T10:30:00.000Z",
  },
  {
    id: "evt-3",
    order: 3,
    eventType: "change",
    actor: "multi_copilot",
    summary: "Pesquisa importada (colar): 8 itens → Itens Inteligentes.",
    createdAt: "2026-07-02T14:15:00.000Z",
  },
  {
    id: "evt-4",
    order: 4,
    eventType: "approval",
    actor: "maria.souza",
    summary: "Item aprovado: Notebook 14'' i5 16GB.",
    createdAt: "2026-07-03T08:45:00.000Z",
  },
];

const EVENT_DOT_CLASSES: Record<string, string> = {
  workspace_created: "bg-indigo-500",
  change: "bg-blue-500",
  approval: "bg-green-500",
  decision: "bg-amber-500",
};

export type TimelinePanelProps = {
  timeline?: TimelineEvent[];
};

export default function TimelinePanel({
  timeline = DEFAULT_TIMELINE,
}: TimelinePanelProps) {
  const ordered = [...timeline].sort((a, b) => a.order - b.order);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="mb-4 font-semibold text-gray-900">
        Linha do tempo do processo
      </h2>
      {ordered.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhum evento registrado.</p>
      ) : (
        <ol className="relative border-l border-gray-200 pl-6">
          {ordered.map((e) => (
            <li key={e.id} className="mb-6 last:mb-0">
              <span
                className={`absolute -left-[7px] mt-1 h-3 w-3 rounded-full ring-4 ring-white ${
                  EVENT_DOT_CLASSES[e.eventType] ?? "bg-gray-400"
                }`}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {e.eventType}
                </span>
                <time className="text-xs text-gray-400">
                  {new Date(e.createdAt).toLocaleString("pt-BR")}
                </time>
              </div>
              <p className="mt-1 text-sm text-gray-800">{e.summary}</p>
              <p className="mt-0.5 text-xs text-gray-500">por {e.actor}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
