import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import {
  ASSURANCE_LABEL, ORIGINAL_VERIFICATION_LABEL, RELATION_LABEL, type IntegrityView, type OriginalVerificationStatusKey,
} from "@/lib/institutionalTemplatesView";

export interface OriginalVerificationResult {
  applicable: boolean; reason?: string; status?: OriginalVerificationStatusKey; message?: string; checkedAt?: string;
}

export interface IntegrityPanelProps {
  integrity: IntegrityView;
  /** Existe arquivo original preservado (habilita a reverificação sob demanda). */
  hasOriginal: boolean;
  verification?: OriginalVerificationResult | null;
  onVerify?: () => void;
  verifying?: boolean;
}

/**
 * Integridade da fonte: separa o que é DECLARADO por pessoas (não verificado) do que o SERVIDOR calculou/derivou/versionou, e explica cada comparação.
 * Nunca apresenta uma declaração como prova.
 */
export function IntegrityPanel({ integrity, hasOriginal, verification, onVerify, verifying = false }: IntegrityPanelProps) {
  return (
    <section aria-label="Integridade da fonte" className="space-y-3 text-sm">
      <h4 className="font-medium">Integridade da fonte</h4>
      <ul className="space-y-2">
        {integrity.items.map((i) => {
          const a = ASSURANCE_LABEL[i.assurance];
          return (
            <li key={i.id} className="rounded-md border p-2" data-integrity-item={i.id}>
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{i.label}</span><StatusBadge label={a.label} tone={a.tone} /></div>
              {i.value && <p className="break-all font-mono text-xs">{i.value}</p>}
              <p className="text-xs text-muted-foreground">{i.explanation}</p>
            </li>
          );
        })}
      </ul>
      <ul className="space-y-1" aria-label="Comparações">
        {integrity.relations.map((r) => {
          const st = RELATION_LABEL[r.status];
          return (
            <li key={r.id} className="flex flex-wrap items-start gap-2 text-xs" data-integrity-relation={r.id}>
              <StatusBadge label={st.label} tone={st.tone} /><span>{r.message}</span>
            </li>
          );
        })}
      </ul>
      {hasOriginal && (
        <div className="space-y-1">
          {onVerify && <Button size="sm" variant="outline" disabled={verifying} onClick={onVerify}>Reverificar arquivo original</Button>}
          {verification && (verification.applicable && verification.status
            ? <p role={verification.status === "VERIFIED" ? undefined : "alert"} className="text-xs" data-testid="original-verification"><StatusBadge label={ORIGINAL_VERIFICATION_LABEL[verification.status].label} tone={ORIGINAL_VERIFICATION_LABEL[verification.status].tone} /> {verification.message}</p>
            : <p className="text-xs text-muted-foreground">{verification.reason}</p>)}
        </div>
      )}
      <ul className="text-xs text-muted-foreground">{integrity.notices.map((n) => <li key={n}>{n}</li>)}</ul>
    </section>
  );
}
