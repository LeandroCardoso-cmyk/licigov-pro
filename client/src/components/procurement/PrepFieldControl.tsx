import type React from "react";
import { DURATION_UNIT_LABEL, type FormValue, type PrepField, type TableRowForm } from "@/lib/editalPreparation";

const DURATION_UNITS = ["minute", "hour", "day", "businessDay", "month", "year"] as const;
const INPUT = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:border-blue-500 focus:outline-none";

const HTML_TYPE: Record<string, string> = { date: "date", datetime: "datetime-local", time: "time", url: "url" };

export interface PrepFieldControlProps {
  field: PrepField;
  value: FormValue;
  error?: string;
  disabled?: boolean;
  onChange: (next: FormValue) => void;
}

function Scalar({ type, id, label, value, enumValues, disabled, onChange }: { type: string; id: string; label: string; value: string; enumValues?: readonly string[]; disabled?: boolean; onChange: (v: string) => void }) {
  if (type === "enum") {
    return (
      <select id={id} aria-label={label} className={INPUT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Não informado</option>
        {(enumValues ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (type === "boolean") {
    return (
      <select id={id} aria-label={label} className={INPUT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">Não informado</option>
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    );
  }
  if (type === "text") {
    return <textarea id={id} aria-label={label} rows={3} className={INPUT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
  const html = HTML_TYPE[type] ?? "text";
  const hint = type === "money" ? "R$ 0,00" : type === "percent" ? "0 a 100" : type === "cnpj" ? "00.000.000/0000-00" : undefined;
  return (
    <input id={id} aria-label={label} type={html} inputMode={["integer", "number", "percent", "money"].includes(type) ? "decimal" : undefined}
      placeholder={hint} className={INPUT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  );
}

/** Controle tipado de UM campo governado (sem JSON). Presentacional: a conversão para o valor canônico é de `editalPreparation.ts`. */
export default function PrepFieldControl({ field, value, error, disabled, onChange }: PrepFieldControlProps) {
  const id = `prep-${field.source}-${field.path}`;
  let control: React.ReactElement;
  if (field.type === "duration") {
    const d = value as { amount: string; unit: string };
    control = (
      <div className="flex gap-2">
        <input id={id} aria-label={field.description} type="text" inputMode="numeric" className={INPUT} value={d.amount} disabled={disabled} onChange={(e) => onChange({ ...d, amount: e.target.value })} />
        <select aria-label={`${field.description} — unidade`} className={INPUT} value={d.unit} disabled={disabled} onChange={(e) => onChange({ ...d, unit: e.target.value })}>
          {DURATION_UNITS.map((u) => <option key={u} value={u}>{DURATION_UNIT_LABEL[u]}</option>)}
        </select>
      </div>
    );
  } else if (field.type === "list") {
    control = (
      <div>
        <textarea id={id} aria-label={field.description} rows={4} className={INPUT} value={value as string} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        <p className="text-xs text-muted-foreground">Um item por linha.</p>
      </div>
    );
  } else if (field.type === "table") {
    const rows = value as TableRowForm[];
    const cols = field.columns ?? [];
    const setCell = (i: number, key: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
    control = (
      <div className="space-y-2" id={id}>
        {rows.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma linha informada.</p>}
        {rows.map((row, i) => (
          <div key={i} className="grid gap-2 rounded-lg border border-border p-2" style={{ gridTemplateColumns: `repeat(${Math.max(cols.length, 1)}, minmax(0, 1fr)) auto` }}>
            {cols.map((c) => (
              <label key={c.key} className="flex flex-col text-xs">
                <span className="mb-1 text-muted-foreground">{c.label}{c.required ? " *" : ""}</span>
                <Scalar type={c.type} id={`${id}-${i}-${c.key}`} label={`${c.label} (linha ${i + 1})`} value={row[c.key] ?? ""} disabled={disabled} onChange={(v) => setCell(i, c.key, v)} />
              </label>
            ))}
            <button type="button" disabled={disabled} className="self-end rounded-lg border border-input px-2 py-2 text-xs" aria-label={`Remover linha ${i + 1}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}>Remover</button>
          </div>
        ))}
        <button type="button" disabled={disabled} className="rounded-lg border border-input px-3 py-1.5 text-xs"
          onClick={() => onChange([...rows, Object.fromEntries(cols.map((c) => [c.key, ""]))])}>Adicionar linha</button>
      </div>
    );
  } else {
    control = <Scalar type={field.type} id={id} label={field.description} value={value as string} enumValues={field.enumValues} disabled={disabled} onChange={onChange} />;
  }
  return (
    <div className="space-y-1" data-field={field.name}>
      <label htmlFor={id} className="block text-sm font-medium text-foreground">
        {field.description || field.name}
        {field.required && !field.conditional && <span className="ml-1 text-destructive" aria-label="obrigatório">*</span>}
        {field.conditional && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-normal text-amber-700 dark:text-amber-300">condicional</span>}
      </label>
      {control}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
