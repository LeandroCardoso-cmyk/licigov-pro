import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { validateLegalEvidenceForm, type LegalEvidenceFormState } from "@/lib/institutionalTemplatesView";

export interface LegalEvidenceView {
  decisionId: string; version: number; sourceLogicalVersion: string; sourceSha256: string; revisionSemanticHash: string;
  recordedByUserId: number; recordedAt: string; declaredBy: { name: string; role: string; userId: number | null }; actDate: string;
  basisReference: string; reason: string; parecerNumber: string | null; parecerDate: string | null; protocol: string | null; procurador: string | null;
  evidenceRefs: readonly string[]; authorityValidation: string;
}
export interface ProvenanceView {
  templateKey: string; displayName: string; sourceLogicalVersion: string; sourceSha256: string; sourceFormat: string; recordedByUserId: number; recordedAt: string;
  inventory: { sha256: string; inputsTotal: number; controlOnlyInputs: number; conditionTypes: number } | null;
}
export interface GovernanceView {
  provenance: ProvenanceView | null; legalEvidence: LegalEvidenceView | null; legalEvidenceHistory: readonly LegalEvidenceView[]; malformedRecords: number; lifecycleNote: string;
}

const short = (h: string) => `${h.slice(0, 12)}…`;
/** Campo ausente = "não informado" (nunca um valor inventado). */
const Optional = ({ label, value }: { label: string; value: string | null }) => (
  <div><dt className="text-xs text-muted-foreground">{label}</dt><dd>{value ?? <span className="text-muted-foreground">não informado</span>}</dd></div>
);

/** Procedência da importação + evidência de aprovação jurídica externa (governança — NÃO é status do ciclo de vida). */
export function GovernanceSummary({ governance: g }: { governance: GovernanceView }) {
  const e = g.legalEvidence;
  return (
    <section aria-label="Governança da revisão" className="space-y-4 text-sm">
      <p className="rounded-md border bg-muted/40 p-3 text-muted-foreground">{g.lifecycleNote}</p>
      {g.malformedRecords > 0 && <p role="alert" className="text-destructive">{g.malformedRecords} registro(s) de governança ilegíveis foram ignorados — não são tratados como válidos.</p>}
      <div>
        <h4 className="font-medium">Procedência da importação</h4>
        {!g.provenance ? <p className="text-muted-foreground">Nenhuma procedência registrada para esta revisão.</p> : (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Modelo (templateKey)</dt><dd className="font-mono text-xs">{g.provenance.templateKey}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Nome de exibição registrado</dt><dd>{g.provenance.displayName}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Versão lógica da fonte</dt><dd>{g.provenance.sourceLogicalVersion}</dd></div>
            <div><dt className="text-xs text-muted-foreground">SHA-256 da fonte</dt><dd className="font-mono text-xs">{short(g.provenance.sourceSha256)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Registrada por (usuário) em</dt><dd>#{g.provenance.recordedByUserId} · {g.provenance.recordedAt}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Inventário</dt><dd>{g.provenance.inventory ? `${g.provenance.inventory.inputsTotal} entradas · ${g.provenance.inventory.controlOnlyInputs} control-only · ${g.provenance.inventory.conditionTypes} tipos de condição` : "não registrado"}</dd></div>
          </dl>
        )}
      </div>
      <div>
        <h4 className="font-medium">Evidência de aprovação jurídica externa</h4>
        {!e ? <p className="text-muted-foreground">Nenhuma evidência registrada. (Opcional para o ciclo de vida; a matriz de prontidão a mostra como pendente.)</p> : (
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Versão do registro</dt><dd>v{e.version}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Versão lógica da fonte aprovada</dt><dd>{e.sourceLogicalVersion}</dd></div>
            <div><dt className="text-xs text-muted-foreground">SHA-256 da fonte aprovada</dt><dd className="font-mono text-xs">{short(e.sourceSha256)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Hash semântico da revisão ligada</dt><dd className="font-mono text-xs">{short(e.revisionSemanticHash)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Registrado por (usuário) em</dt><dd>#{e.recordedByUserId} · {e.recordedAt}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Autoridade declarada</dt><dd>{e.declaredBy.name} — {e.declaredBy.role}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Data do ato (declarada)</dt><dd>{e.actDate}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Base / referência</dt><dd>{e.basisReference}</dd></div>
            <Optional label="Número do parecer" value={e.parecerNumber} />
            <Optional label="Data do parecer" value={e.parecerDate} />
            <Optional label="Protocolo" value={e.protocol} />
            <Optional label="Procurador" value={e.procurador} />
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Referências</dt><dd>{e.evidenceRefs.length ? e.evidenceRefs.join(" · ") : <span className="text-muted-foreground">nenhuma</span>}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Competência</dt><dd>{e.authorityValidation} — o sistema não valida a competência de quem aprovou.</dd></div>
          </dl>
        )}
        {g.legalEvidenceHistory.length > 1 && <p className="mt-2 text-xs text-muted-foreground">{g.legalEvidenceHistory.length} versões no histórico (append-only); a mais recente supera as anteriores.</p>}
      </div>
    </section>
  );
}

export interface LegalEvidenceFormProps {
  value: LegalEvidenceFormState;
  onChange: (next: LegalEvidenceFormState) => void;
  showErrors?: boolean;
}

const TEXT: Array<{ key: Exclude<keyof LegalEvidenceFormState, "confirmed" | "reason" | "refs">; label: string; placeholder: string; type?: string; optional?: boolean }> = [
  { key: "sourceLogicalVersion", label: "Versão lógica do conteúdo-fonte aprovado", placeholder: "ex.: 1.0.1-draft" },
  { key: "sourceSha256", label: "SHA-256 do conteúdo-fonte aprovado", placeholder: "64 caracteres hexadecimais" },
  { key: "parecerNumber", label: "Número do parecer (opcional)", placeholder: "deixe em branco se não informado", optional: true },
  { key: "parecerDate", label: "Data do parecer (opcional)", placeholder: "AAAA-MM-DD", type: "date", optional: true },
  { key: "protocol", label: "Protocolo (opcional)", placeholder: "deixe em branco se não informado", optional: true },
  { key: "procurador", label: "Procurador (opcional)", placeholder: "deixe em branco se não informado", optional: true },
  { key: "decidedByName", label: "Autoridade/órgão que aprovou (declarado por você)", placeholder: "Nome ou órgão" },
  { key: "decidedByRole", label: "Cargo / função", placeholder: "Ex.: Procuradoria Jurídica" },
  { key: "decidedAt", label: "Data do ato (declarada)", placeholder: "AAAA-MM-DD", type: "date" },
  { key: "basisReference", label: "Base / referência da aprovação", placeholder: "Documento, ata ou processo" },
];

/**
 * Formulário da evidência. Os campos opcionais NUNCA são pré-preenchidos: ausentes ⇒ não gravados. Registrar a evidência
 * NÃO aprova nem publica a revisão (decisões humanas distintas, no ciclo de vida).
 */
export function LegalEvidenceForm({ value, onChange, showErrors = false }: LegalEvidenceFormProps) {
  const { errors } = validateLegalEvidenceForm(value);
  const err = (k: keyof LegalEvidenceFormState) => (showErrors ? errors[k] : undefined);
  return (
    <form className="space-y-3" aria-label="Registrar evidência de aprovação jurídica" onSubmit={(e) => e.preventDefault()}>
      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        Registra que a aprovação jurídica do conteúdo-fonte ocorreu fora do sistema. Não é um status: a revisão continua DRAFT/APPROVED/PUBLISHED conforme as decisões humanas próprias.
        Campos opcionais em branco ficam como “não informado”.
      </p>
      {TEXT.map((f) => (
        <div key={f.key} className="space-y-1">
          <Label htmlFor={`ev-${f.key}`}>{f.label}</Label>
          <Input id={`ev-${f.key}`} type={f.type ?? "text"} value={value[f.key]} placeholder={f.placeholder} aria-invalid={err(f.key) ? true : undefined}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
          {err(f.key) && <p role="alert" className="text-xs text-destructive">{err(f.key)}</p>}
        </div>
      ))}
      <div className="space-y-1">
        <Label htmlFor="ev-refs">Referências adicionais (uma por linha, opcional)</Label>
        <Textarea id="ev-refs" rows={2} value={value.refs} onChange={(e) => onChange({ ...value, refs: e.target.value })} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="ev-reason">Justificativa do registro</Label>
        <Textarea id="ev-reason" rows={3} value={value.reason} aria-invalid={err("reason") ? true : undefined} onChange={(e) => onChange({ ...value, reason: e.target.value })} />
        {err("reason") && <p role="alert" className="text-xs text-destructive">{err("reason")}</p>}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={value.confirmed} onChange={(e) => onChange({ ...value, confirmed: e.target.checked })} />
        <span>Confirmo que estou registrando, sob minha responsabilidade, a informação de que a aprovação jurídica externa ocorreu.</span>
      </label>
      {err("confirmed") && <p role="alert" className="text-xs text-destructive">{err("confirmed")}</p>}
    </form>
  );
}
