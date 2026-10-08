import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScopeFields, type ScopeFieldsProps } from "./ScopeFields";
import { DOCUMENT_KIND_LABEL, emptyRegisterForm, validateRegisterForm, type RegisterFormState, type RegistrationPresetView } from "@/lib/institutionalTemplatesView";

export interface RegisterModelFormProps {
  value: RegisterFormState;
  onChange: (next: RegisterFormState) => void;
  presets: readonly RegistrationPresetView[];
  documentKinds: readonly string[];
  today: string;
  hasDocx: boolean;
  onDocxFile?: (file: File | undefined) => void;
  scopeSuggestions?: ScopeFieldsProps["suggestions"];
  showErrors?: boolean;
}

/**
 * Registro de um modelo (ex.: "Edital — Pregão Eletrônico — BLL"). A revisão SEMPRE nasce DRAFT — mesmo com aprovação jurídica
 * externa: ainda são necessárias a aprovação humana no sistema e a decisão humana (distinta) de publicar.
 */
export function RegisterModelForm({ value, onChange, presets, documentKinds, today, hasDocx, onDocxFile, scopeSuggestions, showErrors = false }: RegisterModelFormProps) {
  const { errors } = validateRegisterForm(value, hasDocx);
  const err = (k: string) => (showErrors ? errors[k] : undefined);
  const set = (patch: Partial<RegisterFormState>) => onChange({ ...value, ...patch });
  const isPackage = value.sourceKind === "MODEL_PACKAGE";
  const pkgPreset = presets.find((x) => x.presetId === value.templateKey && x.sourceKind === "MODEL_PACKAGE");
  const text = (key: keyof RegisterFormState & string, label: string, placeholder = "", type = "text", readOnly = false) => (
    <div className="space-y-1" key={key}>
      <Label htmlFor={`reg-${key}`}>{label}</Label>
      <Input id={`reg-${key}`} type={type} value={String(value[key])} placeholder={placeholder} readOnly={readOnly} aria-invalid={err(key) ? true : undefined} onChange={(e) => set({ [key]: e.target.value } as Partial<RegisterFormState>)} />
      {err(key) && <p role="alert" className="text-xs text-destructive">{err(key)}</p>}
    </div>
  );
  return (
    <form className="space-y-4" aria-label="Registrar modelo" onSubmit={(e) => e.preventDefault()}>
      <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
        O registro cria uma revisão em RASCUNHO (DRAFT) e grava a procedência (versão lógica + SHA-256 da fonte). Nunca aprova nem publica; não cria vínculo, documento nem usa IA.
      </p>
      {presets.length > 0 && (
        <div className="space-y-1">
          <Label htmlFor="reg-preset">Modelo do piloto (preenche rótulos e escopo — não preenche conteúdo)</Label>
          <select id="reg-preset" className="w-full rounded-md border bg-background p-2 text-sm" defaultValue=""
            onChange={(e) => { const p = presets.find((x) => x.presetId === e.target.value); if (p) onChange({ ...emptyRegisterForm(today, p), decidedByName: value.decidedByName, decidedByRole: value.decidedByRole }); }}>
            <option value="">Registro livre…</option>
            {presets.map((p) => <option key={p.presetId} value={p.presetId}>{p.displayName}</option>)}
          </select>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="reg-targetKind">Destino</Label>
          <select id="reg-targetKind" className="w-full rounded-md border bg-background p-2 text-sm" value={value.targetKind} onChange={(e) => set({ targetKind: e.target.value as RegisterFormState["targetKind"] })}>
            <option value="NEW_IDENTITY">Novo modelo</option><option value="EXISTING_IDENTITY">Nova revisão de modelo existente</option>
          </select>
        </div>
        {value.targetKind === "NEW_IDENTITY" ? (
          <div className="space-y-1">
            <Label htmlFor="reg-documentKind">Tipo de documento</Label>
            <select id="reg-documentKind" className="w-full rounded-md border bg-background p-2 text-sm" value={value.documentKind} onChange={(e) => set({ documentKind: e.target.value })}>
              {documentKinds.map((k) => <option key={k} value={k}>{DOCUMENT_KIND_LABEL[k] ?? k}</option>)}
            </select>
          </div>
        ) : text("existingIdentityId", "Id do modelo existente")}
        {value.targetKind === "NEW_IDENTITY" && text("slug", "Identificador (slug)", "ex.: edital-pregao-eletronico-bll")}
        {text("templateKey", "templateKey", "EDITAL_PREGAO_ELETRONICO_BLL", "text", isPackage)}
        <div className="sm:col-span-2">{text("displayName", "Nome de exibição", "Edital — Pregão Eletrônico — BLL")}</div>
      </div>
      <ScopeFields idPrefix="reg-scope" documentKind={value.documentKind} value={value.scope} onChange={(scope) => set({ scope })} suggestions={scopeSuggestions} showErrors={showErrors} />
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Conteúdo-fonte</legend>
        <div className="flex gap-4 text-sm">
          {pkgPreset && (
            <label className="flex items-center gap-1">
              <input type="radio" name="reg-source" checked={isPackage} onChange={() => set({ sourceKind: "MODEL_PACKAGE", sourceText: "", inventoryText: "", sourceLogicalVersion: pkgPreset.sourceLogicalVersion ?? "", sourceSha256: pkgPreset.sourceSha256 ?? "" })} />
              Pacote aprovado versionado no servidor
            </label>
          )}
          {(["AST", "MARKDOWN", "DOCX"] as const).map((k) => <label key={k} className="flex items-center gap-1"><input type="radio" name="reg-source" checked={value.sourceKind === k} onChange={() => set(isPackage ? { sourceKind: k, sourceLogicalVersion: "", sourceSha256: "" } : { sourceKind: k })} />{k === "AST" ? "AST nativo (JSON)" : k === "MARKDOWN" ? "Markdown" : "DOCX"}</label>)}
        </div>
        {isPackage ? (
          <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm" aria-label="Pacote aprovado versionado no servidor">
            <p className="font-medium">Pacote aprovado versionado no servidor</p>
            <p className="text-muted-foreground">O conteúdo, o catálogo e o inventário são resolvidos no servidor a partir do pacote aprovado; nada é enviado pelo navegador.</p>
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">templateKey</dt><dd className="font-mono">{value.templateKey}</dd>
              <dt className="text-muted-foreground">Versão lógica</dt><dd className="font-mono">{value.sourceLogicalVersion}</dd>
              <dt className="text-muted-foreground">SHA-256</dt><dd className="break-all font-mono text-xs">{value.sourceSha256}</dd>
              <dt className="text-muted-foreground">Escopo</dt><dd>{[value.scope.modality, value.scope.form, value.scope.platform].filter(Boolean).join(" · ")}</dd>
            </dl>
          </div>
        ) : value.sourceKind === "DOCX"
          ? <Input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => onDocxFile?.(e.target.files?.[0])} />
          : <Textarea rows={8} className="font-mono text-xs" value={value.sourceText} aria-label="Conteúdo-fonte" onChange={(e) => set({ sourceText: e.target.value })} />}
        {err("source") && <p role="alert" className="text-xs text-destructive">{err("source")}</p>}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        {text("sourceLogicalVersion", "Versão lógica da fonte", "ex.: 1.0.1-draft", "text", isPackage)}
        {text("sourceSha256", "SHA-256 da fonte", "64 hexadecimais", "text", isPackage)}
      </div>
      {!isPackage && (
        <div className="space-y-1">
          <Label htmlFor="reg-inventory">Inventário da fonte (JSON, opcional — só o hash e as contagens são gravados)</Label>
          <Textarea id="reg-inventory" rows={3} className="font-mono text-xs" value={value.inventoryText} onChange={(e) => set({ inventoryText: e.target.value })} />
          {err("inventoryText") && <p role="alert" className="text-xs text-destructive">{err("inventoryText")}</p>}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {text("decidedByName", "Quem registra (nome)")}
        {text("decidedByRole", "Cargo / função")}
        {text("decidedAt", "Data do ato", "AAAA-MM-DD", "date")}
        {text("basisReference", "Referência da fonte/ato")}
      </div>
      <div className="space-y-1">
        <Label htmlFor="reg-reason">Justificativa</Label>
        <Textarea id="reg-reason" rows={2} value={value.reason} onChange={(e) => set({ reason: e.target.value })} />
        {err("reason") && <p role="alert" className="text-xs text-destructive">{err("reason")}</p>}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={value.confirmed} onChange={(e) => set({ confirmed: e.target.checked })} />
        <span>Confirmo o registro deste modelo como RASCUNHO, sob minha responsabilidade.</span>
      </label>
      {err("confirmed") && <p role="alert" className="text-xs text-destructive">{err("confirmed")}</p>}
    </form>
  );
}
