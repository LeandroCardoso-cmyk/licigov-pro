import React from "react";
import { formatDateTime } from "./labels";

/**
 * OpinionHistory — PRESENTATIONAL.
 *
 * Histórico interno do parecer (eventos do workspace do Procurador) e as versões
 * do documento. Append-only, imutável — rastreabilidade obrigatória.
 */

export interface HistoryEvent {
  id: string;
  order: number;
  eventType: string;
  actor: string;
  summary: string;
  createdAt: string;
}

export interface OpinionVersion {
  id: string;
  version: number;
  contentHash: string;
  author: number;
  createdAt: string;
}

export interface OpinionHistoryProps {
  history?: HistoryEvent[];
  versions?: OpinionVersion[];
}

export default function OpinionHistory({ history = [], versions = [] }: OpinionHistoryProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Histórico do parecer</h3>
        {history.length === 0 ? (
          <p className="text-xs text-gray-400">Sem eventos.</p>
        ) : (
          <ul className="space-y-2">
            {[...history].sort((a, b) => a.order - b.order).map((h) => (
              <li key={h.id} className="flex items-start justify-between gap-3 border-b border-gray-50 pb-2 last:border-0">
                <div>
                  <p className="text-sm text-gray-800">{h.summary}</p>
                  <p className="text-xs text-gray-500">{h.eventType} · por {h.actor}</p>
                </div>
                <span className="shrink-0 text-[11px] text-gray-400">{formatDateTime(h.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-gray-900">Versões</h3>
        {versions.length === 0 ? (
          <p className="text-xs text-gray-400">Nenhuma versão registrada.</p>
        ) : (
          <ul className="space-y-1">
            {[...versions].sort((a, b) => a.version - b.version).map((v) => (
              <li key={v.id} className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-1.5 text-xs">
                <span className="font-medium text-gray-700">v{v.version}</span>
                <span className="font-mono text-[10px] text-gray-400">{v.contentHash.slice(0, 12)}…</span>
                <span className="text-gray-400">{formatDateTime(v.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
