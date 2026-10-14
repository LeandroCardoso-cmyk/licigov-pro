import { OWNERSHIP_FILTER_LABEL, type OwnershipFilter } from "@/lib/institutionalTemplatesView";

const ORDER: readonly OwnershipFilter[] = ["ALL", "PLATFORM", "TENANT", "DERIVED", "UNCLASSIFIED"];

/** Visões do catálogo: modelos da plataforma · da minha prefeitura · derivados. Contagem sempre visível; sem esconder nenhum modelo em "Todos". */
export function OwnershipTabs({ value, counts, onChange }: { value: OwnershipFilter; counts: Record<OwnershipFilter, number>; onChange: (v: OwnershipFilter) => void }) {
  return (
    <div role="tablist" aria-label="Origem dos modelos" className="flex flex-wrap gap-2">
      {ORDER.filter((k) => k === "ALL" || counts[k] > 0 || k === value).map((k) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} data-ownership={k} onClick={() => onChange(k)}
          className={`rounded-full border px-3 py-1 text-sm ${value === k ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}>
          {OWNERSHIP_FILTER_LABEL[k]} <span className="text-xs opacity-80">({counts[k]})</span>
        </button>
      ))}
    </div>
  );
}
