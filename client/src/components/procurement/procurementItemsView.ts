/**
 * Itens da contratação — view-model PURO (testável sem DOM). Nenhuma decisão de identidade, lote ou
 * quantidade é tomada aqui: só apresentação do que o servidor resolveu.
 */

export interface ItemSourceView {
  sourceType: string; sourceId: string; sourceQuantity: number | null; sourceLotCode: string | null;
  sourceDescription: string; sourceUnit: string;
}

export interface ItemView {
  id: string; description: string; unit: string; lotId: string | null; ordinal: number; revision: number; origin: string;
  provenance: {
    description: { source: string; overriddenBy: number | null; sourceValue: string | null };
    unit: { source: string; overriddenBy: number | null; sourceValue: string | null };
    lot: { assignedBy: number | null; source: string | null };
    manual?: { reason: string | null } | null;
  };
  plannedQuantity: { value: number | null; status: string; sourceType: string | null; mode: string | null; actorUserId: number | null };
  sources: ItemSourceView[];
  unitReferencePriceCents: number | null; priceAmbiguous: boolean; estimatedTotalCents: number | null;
}

export interface LotView { id: string; code: string; name: string; description: string | null; ordinal: number; revision: number; itemCount: number }

export interface ItemGroup { lot: LotView | null; title: string; items: ItemView[] }

/** Sem lotes ⇒ lista simples (um grupo sem título). Com lotes ⇒ lotes em ordem + "Sem lote / não atribuídos". */
export function groupItems(items: readonly ItemView[], lots: readonly LotView[]): ItemGroup[] {
  if (!lots.length) return [{ lot: null, title: "", items: [...items] }];
  const groups: ItemGroup[] = [...lots].sort((a, b) => a.ordinal - b.ordinal)
    .map((l) => ({ lot: l, title: `LOTE ${l.code} — ${l.name}`, items: items.filter((i) => i.lotId === l.id) }));
  const unassigned = items.filter((i) => i.lotId === null || !lots.some((l) => l.id === i.lotId));
  if (unassigned.length) groups.push({ lot: null, title: "Sem lote / não atribuídos", items: unassigned });
  return groups;
}

const SOURCE_LABELS: Record<string, string> = {
  price_research: "Pesquisa de Preços",
  dfd: "DFD",
  manual: "Informado manualmente",
  user: "Alterado por você",
};

export function originLabel(origin: string): string {
  return SOURCE_LABELS[origin] ?? origin;
}

export function formatQty(q: number | null): string {
  if (q === null) return "";
  return String(q).replace(".", ",");
}

export function plannedQuantityLabel(p: ItemView["plannedQuantity"]): string {
  if (p.status === "conflict") return "Informações divergentes — defina a quantidade prevista";
  if (p.value === null) return "Não definida";
  return formatQty(p.value);
}

export function plannedQuantityOrigin(p: ItemView["plannedQuantity"]): string | null {
  if (p.value === null) return null;
  if (p.mode?.startsWith("adopted_source")) return `Quantidade do documento adotada pelo usuário #${p.actorUserId ?? "?"}`;
  if (p.sourceType === "dfd") return "Informada no DFD";
  return `Informada pelo usuário #${p.actorUserId ?? "?"}`;
}

export function sourceQuantityLabel(s: ItemSourceView): string | null {
  if (s.sourceQuantity === null) return null;
  return `${s.sourceType === "dfd" ? "Quantidade no DFD" : "Quantidade no documento"}: ${formatQty(s.sourceQuantity)}`;
}

/** Linhas de proveniência por campo ("de onde veio?"). */
export function provenanceLines(it: ItemView): string[] {
  const field = (label: string, f: ItemView["provenance"]["description"]) =>
    f.overriddenBy !== null
      ? `${label}: alterada pelo usuário #${f.overriddenBy}${f.sourceValue ? ` (na fonte: "${f.sourceValue}")` : ""}`
      : `${label}: ${originLabel(f.source)}`;
  const lines = [field("Descrição", it.provenance.description), field("Unidade", it.provenance.unit)];
  const q = plannedQuantityOrigin(it.plannedQuantity);
  if (q) lines.push(`Quantidade prevista: ${q}`);
  for (const s of it.sources) {
    const l = sourceQuantityLabel(s);
    if (l) lines.push(`${l} (${originLabel(s.sourceType)})`);
  }
  if (it.lotId && it.provenance.lot.assignedBy !== null) {
    lines.push(`Lote: ${it.provenance.lot.source === "source_structure" ? "estrutura identificada na fonte" : "atribuído manualmente"} pelo usuário #${it.provenance.lot.assignedBy}`);
  }
  if (it.provenance.manual?.reason) lines.push(`Motivo: ${it.provenance.manual.reason}`);
  return lines;
}

/** Itens cuja quantidade do documento pode ser adotada no lote "Usar quantidades do documento" (preview). */
export function adoptableQuantities(items: readonly ItemView[]): Array<{ item: ItemView; source: ItemSourceView }> {
  const out: Array<{ item: ItemView; source: ItemSourceView }> = [];
  for (const it of items) {
    const s = it.sources.find((x) => x.sourceQuantity !== null);
    if (s && it.plannedQuantity.value === null) out.push({ item: it, source: s });
  }
  return out;
}

export const CANDIDATE_STATUS_LABELS: Record<string, string> = {
  linked: "Já está nos itens da contratação",
  possible_match: "Possível item já cadastrado",
  ambiguous: "Mais de um item cadastrado corresponde",
  new: "Novo item",
  blocked: "Aguardando revisão na Pesquisa",
};

/** Validação de exibição (a validação autoritativa é do servidor). */
export function quantityInputError(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const s = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(s) || !(Number(s) > 0)) return "Informe um número maior que zero (até 3 casas decimais).";
  return null;
}

export function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
