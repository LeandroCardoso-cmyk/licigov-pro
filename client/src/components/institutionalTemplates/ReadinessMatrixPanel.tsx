import { StatusBadge } from "@/components/ui/StatusBadge";
import { READINESS_STATUS_LABEL, readinessHeadline, type ReadinessMatrixView } from "@/lib/institutionalTemplatesView";

/** Matriz de prontidão antes de publicar. Mostra TODAS as verificações (PASS · BLOCKED · NOT_APPLICABLE) — nada é omitido. */
export function ReadinessMatrixPanel({ matrix }: { matrix: ReadinessMatrixView }) {
  return (
    <section aria-label="Matriz de prontidão" className="space-y-3 text-sm">
      <p role={matrix.overall === "BLOCKED" ? "alert" : undefined} className={matrix.overall === "BLOCKED" ? "font-medium text-destructive" : "font-medium"}>{readinessHeadline(matrix)}</p>
      <ul className="divide-y rounded-md border">
        {matrix.checks.map((c) => {
          const st = READINESS_STATUS_LABEL[c.status];
          return (
            <li key={c.id} className="space-y-1 p-3" data-check={c.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{c.label}</span>
                <StatusBadge label={st.label} tone={st.tone} />
              </div>
              <p className="text-muted-foreground">{c.detail}</p>
              {c.findings.length > 0 && (
                <ul className="list-disc pl-5 text-xs">
                  {c.findings.map((f) => <li key={f}>{f}</li>)}
                  {c.findingsTotal > c.findings.length && <li>… e mais {c.findingsTotal - c.findings.length} achado(s)</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="font-mono text-xs text-muted-foreground">hash da matriz {matrix.matrixHash.slice(0, 16)}…</p>
      <ul className="text-xs text-muted-foreground">{matrix.notices.map((n) => <li key={n}>{n}</li>)}</ul>
    </section>
  );
}
