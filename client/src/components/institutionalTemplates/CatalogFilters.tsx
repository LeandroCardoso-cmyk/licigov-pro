import { Label } from "@/components/ui/label";
import { DOCUMENT_KIND_LABEL, STATUS_LABEL, STATUS_ORDER, type CatalogFilterState } from "@/lib/institutionalTemplatesView";

export interface CatalogFiltersProps {
  value: CatalogFilterState;
  onChange: (next: CatalogFilterState) => void;
  documentKinds: readonly string[];
  options: { modality: readonly string[]; form: readonly string[]; platform: readonly string[] };
}

const select = "w-full rounded-md border bg-background p-2 text-sm";

/** Filtros do catálogo: tipo de documento, modalidade, forma, plataforma e status da revisão. Sem página separada por modelo. */
export function CatalogFilters({ value, onChange, documentKinds, options }: CatalogFiltersProps) {
  const field = (key: keyof CatalogFilterState, label: string, opts: readonly { value: string; label: string }[]) => (
    <div className="space-y-1" key={key}>
      <Label htmlFor={`flt-${key}`}>{label}</Label>
      <select id={`flt-${key}`} className={select} value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })}>
        <option value="">Todos</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
  return (
    <form aria-label="Filtros do catálogo" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()}>
      {field("documentKind", "Tipo de documento", documentKinds.map((k) => ({ value: k, label: DOCUMENT_KIND_LABEL[k] ?? k })))}
      {field("modality", "Modalidade", options.modality.map((v) => ({ value: v, label: v })))}
      {field("form", "Forma", options.form.map((v) => ({ value: v, label: v })))}
      {field("platform", "Plataforma", options.platform.map((v) => ({ value: v, label: v })))}
      {field("status", "Status da revisão", STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABEL[s] })))}
    </form>
  );
}
