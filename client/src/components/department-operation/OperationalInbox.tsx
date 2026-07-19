import React from "react";
import { trpc } from "../../lib/trpc";
import { RECORD_TYPE_LABELS } from "./labels";

/**
 * OperationalInbox — REAL (tRPC).
 *
 * ÁREA 5 — Minha Caixa de Entrada: pendências do usuário (pareceres, solicitações,
 * registros/tarefas). Somente do usuário.
 */

export interface OperationalInboxProps { onOpenReference?: (type: string, id: string) => void }

export default function OperationalInbox({ onOpenReference }: OperationalInboxProps) {
  const { data, isLoading } = trpc.departmentOperation.inbox.useQuery();
  const legalOpinions = data?.legalOpinions ?? [];
  const requests = data?.institutionalRequests ?? [];
  const records = data?.records ?? [];

  const sections: Array<{ title: string; count: number; items: React.ReactNode }> = [
    {
      title: "Pareceres", count: legalOpinions.length,
      items: legalOpinions.map((o) => (
        <li key={o.id}>
          <button type="button" onClick={() => onOpenReference?.("legal_opinion", o.id)} className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-muted">
            <span className="line-clamp-1 text-sm text-foreground">{o.requestType}</span>
            <span className="text-[11px] text-muted-foreground">{o.currentStage}</span>
          </button>
        </li>
      )),
    },
    {
      title: "Solicitações institucionais", count: requests.length,
      items: requests.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpenReference?.("institutional_request", r.id)} className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-muted">
            <span className="line-clamp-1 text-sm text-foreground">{r.title}</span>
            <span className="text-[11px] text-muted-foreground">{r.priority}</span>
          </button>
        </li>
      )),
    },
    {
      title: "Registros e tarefas", count: records.length,
      items: records.map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpenReference?.("operation_record", r.id)} className="flex w-full items-center justify-between px-2 py-1.5 text-left hover:bg-muted">
            <span className="line-clamp-1 text-sm text-foreground">{r.object || r.number || RECORD_TYPE_LABELS[r.recordType]}</span>
            <span className="text-[11px] text-muted-foreground">{RECORD_TYPE_LABELS[r.recordType] ?? r.recordType}</span>
          </button>
        </li>
      )),
    },
  ];

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="h-32 animate-pulse rounded-lg bg-muted" />
      ) : (
        sections.map((s) => (
          <div key={s.title} className="rounded-lg border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <h3 className="text-sm font-semibold text-foreground">{s.title}</h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{s.count}</span>
            </div>
            {s.count === 0 ? <p className="p-4 text-center text-xs text-muted-foreground">Nada pendente.</p> : <ul className="divide-y divide-border p-2">{s.items}</ul>}
          </div>
        ))
      )}
    </div>
  );
}
