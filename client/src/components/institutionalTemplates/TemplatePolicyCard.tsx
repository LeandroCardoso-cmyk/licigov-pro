import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DecisionForm } from "./DecisionForm";
import { POLICY_KIND_LABEL, policyHeadline, validatePolicyForm, type PolicyFormState, type PolicyView } from "@/lib/institutionalTemplatesView";

export interface TemplatePolicyCardProps {
  policy: PolicyView;
  /** Pode estabelecer a política (piso `policy` — gerente+). O servidor reautoriza. */
  canEdit: boolean;
  /** Formulário aberto (null = fechado). */
  form: PolicyFormState | null;
  onOpen: () => void;
  onChange: (next: PolicyFormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
  pending?: boolean;
  showErrors?: boolean;
}

const ROLE_LABEL = { manager: "gerente", owner: "titular (owner)" } as const;

/**
 * Política do órgão sobre os SEUS modelos. Deixa explícito que a decisão é do órgão, auditável e versionada, e que o que muda é a
 * exigência para DISPONIBILIZAR modelos no catálogo interno — não a análise jurídica dos documentos elaborados (Procuradoria).
 */
export function TemplatePolicyCard({ policy, canEdit, form, onOpen, onChange, onCancel, onSubmit, pending = false, showErrors = false }: TemplatePolicyCardProps) {
  const { errors, valid } = form ? validatePolicyForm(form, policy) : { errors: {}, valid: false };
  return (
    <Card aria-label="Política de governança de modelos">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Política de governança dos modelos</CardTitle>
          <StatusBadge label={POLICY_KIND_LABEL[policy.kind].label} tone={POLICY_KIND_LABEL[policy.kind].tone} />
        </div>
        <CardDescription data-testid="policy-headline">{policyHeadline(policy)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {policy.note && <p className="text-muted-foreground">{policy.note}</p>}
        {policy.transition && <p data-testid="policy-transition" className={policy.kind === "LEGACY_COMPAT" ? "rounded border border-amber-500/50 p-2" : "text-muted-foreground"}>{policy.transition.explanation}</p>}
        {policy.malformed && <p role="alert" className="text-destructive">O registro da política está ilegível: vale o padrão estrito até que o órgão a restabeleça.</p>}
        {policy.history.length > 0 && (
          <ul className="space-y-1 text-xs" aria-label="Histórico da política">
            {policy.history.map((h) => (
              <li key={h.version} className="rounded border p-2">
                <span className="font-medium">Versão {h.version}</span> — {h.policy ? `${h.policy.legalEvidence === "REQUIRED" ? "evidência jurídica obrigatória" : "evidência jurídica opcional"}; aprovar ≥ ${h.policy.approveMinRole}; publicar ≥ ${h.policy.publishMinRole}` : "registro ilegível"}
                <br />Declarado por {h.declaredBy.name} ({h.declaredBy.role}) em {h.actDate}. Justificativa: {h.reason}
              </li>
            ))}
          </ul>
        )}
        {!form && (canEdit
          ? <Button size="sm" variant="outline" onClick={onOpen}>Alterar política</Button>
          : <p className="text-xs text-muted-foreground">Somente gerentes definem a política do órgão.</p>)}
        {form && (
          <form className="space-y-3" aria-label="Alterar política" onSubmit={(e) => e.preventDefault()}>
            <fieldset className="space-y-2">
              <legend className="font-medium">Evidência de análise jurídica prévia do modelo</legend>
              {(["REQUIRED", "OPTIONAL"] as const).map((v) => (
                <label key={v} className="flex items-start gap-2">
                  <input type="radio" name="legalEvidence" className="mt-1" checked={form.legalEvidence === v} onChange={() => onChange({ ...form, legalEvidence: v })} />
                  <span>{v === "REQUIRED" ? "Obrigatória — bloqueia a disponibilização sem evidência registrada." : "Opcional — não bloqueia; se registrada, permanece auditável."}</span>
                </label>
              ))}
            </fieldset>
            {(["approveMinRole", "publishMinRole"] as const).map((k) => (
              <div key={k} className="space-y-1">
                <Label htmlFor={`pol-${k}`}>{k === "approveMinRole" ? "Quem pode aprovar modelos (papel mínimo)" : "Quem pode disponibilizar modelos no catálogo (papel mínimo)"}</Label>
                <select id={`pol-${k}`} className="w-full rounded-md border bg-background p-2" value={form[k]} onChange={(e) => onChange({ ...form, [k]: e.target.value as "manager" | "owner" })}>
                  {(["manager", "owner"] as const).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">O piso nunca fica abaixo de gerente. A mudança vale para novas aprovações/publicações; nada já publicado é alterado.</p>
            <DecisionForm action="APPROVE" revisionLabel="Política de governança de modelos do órgão" value={form.decision} showErrors={showErrors} onChange={(d) => onChange({ ...form, decision: d })} />
            {showErrors && (errors as { unchanged?: string }).unchanged && <p role="alert" className="text-xs text-destructive">{(errors as { unchanged?: string }).unchanged}</p>}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onCancel}>Cancelar</Button>
              <Button size="sm" disabled={pending || (showErrors && !valid)} onClick={onSubmit}>Registrar política</Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
