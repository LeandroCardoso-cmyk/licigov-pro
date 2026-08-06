/**
 * PR B.2.2 — Resumo auditável da sessão de ingestão.
 *
 * Mostra a contagem por estado de revisão e os identificadores de rastreabilidade (sessão e
 * processo) — nunca URLs assinadas, credenciais ou conteúdo. Serve à observabilidade e ao suporte.
 */
import { cn } from "@/lib/utils";

interface StagingSummary { total: number; pending: number; approved: number; rejected: number; skipped: number }

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-2 text-center">
      <div className={cn("text-lg font-semibold text-foreground", tone)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function IngestionAuditSummary({
  summary,
  sessionId,
  procurementProcessId,
}: {
  summary: StagingSummary | null;
  sessionId?: number | null;
  procurementProcessId?: string | null;
}) {
  return (
    <div className="space-y-2">
      {summary && (
        <div className="grid grid-cols-5 gap-2">
          <Stat label="Total" value={summary.total} />
          <Stat label="Pendentes" value={summary.pending} tone="text-amber-700 dark:text-amber-300" />
          <Stat label="Aceitos" value={summary.approved} tone="text-green-700 dark:text-green-300" />
          <Stat label="Rejeitados" value={summary.rejected} tone="text-red-700 dark:text-red-300" />
          <Stat label="Pulados" value={summary.skipped} tone="text-muted-foreground" />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {sessionId != null && <>Sessão <code className="font-mono">#{sessionId}</code></>}
        {procurementProcessId != null && <> · Processo <code className="font-mono">{procurementProcessId}</code></>}
      </p>
    </div>
  );
}
