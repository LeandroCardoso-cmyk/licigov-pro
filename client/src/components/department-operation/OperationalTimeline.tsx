import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * OperationalTimeline — REAL (tRPC).
 *
 * ÁREA 4 — Timeline Operacional: histórico institucional completo (quem, quando,
 * o quê). Append-only, nunca editável.
 */

function fmt(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function OperationalTimeline() {
  const { data, isLoading } = trpc.departmentOperation.timeline.useQuery({ limit: 100 });
  const timeline = data?.timeline ?? [];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-1 text-sm font-semibold text-gray-900">Timeline Operacional</h3>
      <p className="mb-4 text-xs text-gray-400">Histórico institucional — append-only, imutável.</p>
      {isLoading ? (
        <div className="h-24 animate-pulse rounded-md bg-gray-100" />
      ) : timeline.length === 0 ? (
        <p className="text-xs text-gray-400">Sem eventos registrados.</p>
      ) : (
        <ol className="relative space-y-5 border-l border-gray-200 pl-5">
          {timeline.map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-indigo-500" />
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-indigo-700">{e.action}</span>
                <span className="text-[11px] text-gray-400">{fmt(e.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-800">{e.summary}</p>
              <p className="text-xs text-gray-500">por {e.actor}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
