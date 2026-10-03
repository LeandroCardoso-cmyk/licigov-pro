/**
 * Itens da contratação — view-model PURO (testável sem DOM). Nenhuma decisão de identidade, lote ou
 * quantidade é tomada aqui: só apresentação do que o servidor resolveu.
 */
import { formatCentsBRL } from "@/lib/money";
import { hydrationKey } from "@/lib/formHydration";

export interface ItemSourceView {
  sourceType: string; sourceId: string; sourceQuantity: number | null; sourceLotCode: string | null;
  sourceDescription: string; sourceUnit: string;
  /**
   * R9 / SEM-049 — valor ATUAL da fonte (lido no servidor); `sourceQuantity` é o valor CONGELADO no vínculo.
   * Opcionais para payloads antigos (ausentes ⇒ atual = vínculo).
   */
  currentQuantity?: number | null; sourceFound?: boolean;
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
  /** R9 / SEM-028, SEM-031 — preço vinculado suspenso (opcional para payloads antigos). */
  priceBlockedReason?: "SOURCE_NOT_CURRENT" | "UNIT_MISMATCH" | null;
}

/** R9 / SEM-028, SEM-031 — explicação do preço suspenso (null = sem bloqueio). */
export function priceBlockedText(reason: ItemView["priceBlockedReason"]): string | null {
  if (reason === "SOURCE_NOT_CURRENT") return "Preço de referência suspenso: a fonte da Pesquisa de Preços mudou ou exige revisão. Revise o Item Inteligente antes de usar o preço.";
  if (reason === "UNIT_MISMATCH") return "Preço de referência suspenso: a unidade da cotação é diferente da unidade deste item (nenhuma conversão é feita). Ajuste a unidade ou o vínculo.";
  return null;
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

/** R9 / SEM-055 — quantidade da Pesquisa é COTADA (evidência de preço), não a necessidade. */
export function sourceQuantityKindLabel(sourceType: string): string {
  return sourceType === "dfd" ? "Quantidade no DFD" : "Quantidade cotada (não é a necessidade)";
}

export function sourceQuantityLabel(s: ItemSourceView): string | null {
  if (s.sourceQuantity === null) return null;
  return `${sourceQuantityKindLabel(s.sourceType)}: ${formatQty(s.sourceQuantity)}`;
}

/** R9 / SEM-049 — vínculo × atual de uma fonte (payload antigo sem `currentQuantity` ⇒ atual = vínculo). */
export function sourceQuantityState(s: ItemSourceView): { linked: number | null; current: number | null; found: boolean; changed: boolean } {
  const found = s.sourceFound ?? true;
  const current = s.currentQuantity === undefined ? s.sourceQuantity : s.currentQuantity;
  return { linked: s.sourceQuantity, current: found ? current : null, found, changed: found && current !== s.sourceQuantity };
}

/** Valor que "Usar N" adotaria: o ATUAL da fonte (null = nada a adotar: fonte ausente ou sem quantidade). */
export function adoptableSourceValue(s: ItemSourceView): number | null {
  const st = sourceQuantityState(s);
  return st.found ? st.current : null;
}

/** R9 / SEM-049 — texto do diff exibido ANTES de adotar (null = vínculo e fonte atual coincidem). */
export function sourceQuantityDiffText(s: ItemSourceView): string | null {
  const st = sourceQuantityState(s);
  if (!st.found) return "Fonte não encontrada no documento vigente — nada a adotar.";
  if (!st.changed) return null;
  const f = (q: number | null) => (q === null ? "sem quantidade" : formatQty(q));
  return `A quantidade na fonte mudou — vínculo: ${f(st.linked)} × atual: ${f(st.current)}.`;
}

/**
 * R9 / SEM-055 — "Usar N" sobre uma quantidade prevista JÁ definida pede confirmação explícita (antigo → novo).
 * null = nada a substituir (prevista vazia ou em conflito a resolver).
 */
export function adoptReplaceConfirmText(planned: ItemView["plannedQuantity"], next: number): string | null {
  if (planned.status === "conflict" || planned.value === null) return null;
  return `Substituir a quantidade prevista ${formatQty(planned.value)} por ${formatQty(next)}? A quantidade prevista atual foi definida antes e será trocada pela da fonte.`;
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

/**
 * R9 / SEM-056 (R5.1) — estado PERSISTIDO do formulário da linha do item e a chave da versão persistida. A chave muda a
 * cada escrita (revisão, quantidade prevista/estado, descrição, unidade) ⇒ `useHydratedForm` volta a hidratar a partir
 * do servidor: o campo "Quantidade prevista" nunca fica com um valor antigo que um "Salvar" reverteria.
 */
export const ITEM_FORM_EMPTY: { qty: string | null; description: string | null; unit: string | null } = { qty: "", description: "", unit: "" };
export function itemFormHydration(it: Pick<ItemView, "id" | "revision" | "description" | "unit" | "plannedQuantity">) {
  return {
    server: { qty: formatQty(it.plannedQuantity.value), description: it.description, unit: it.unit },
    key: hydrationKey(it.id, it.revision, it.plannedQuantity.value, it.plannedQuantity.status, it.description, it.unit),
  };
}

export type AdoptableRow = { item: ItemView; sources: ItemSourceView[] };

/**
 * Itens cuja quantidade de uma fonte pode ser adotada no lote "Usar quantidades do documento" (preview): só itens SEM
 * quantidade prevista e com ao menos uma fonte com quantidade ATUAL. R9 / SEM-055: lista TODAS as fontes do item — a
 * pessoa escolhe qual (nenhuma vem pré-escolhida; a quantidade cotada da Pesquisa nunca é o padrão).
 */
export function adoptableQuantities(items: readonly ItemView[]): AdoptableRow[] {
  const out: AdoptableRow[] = [];
  for (const it of items) {
    if (it.plannedQuantity.value !== null || it.plannedQuantity.status === "conflict") continue;
    const sources = it.sources.filter((x) => adoptableSourceValue(x) !== null);
    if (sources.length) out.push({ item: it, sources });
  }
  return out;
}

export const sourceChoiceKey = (s: Pick<ItemSourceView, "sourceType" | "sourceId">) => `${s.sourceType}:${s.sourceId}`;

/**
 * R9 / SEM-055 — alterações do lote a partir das ESCOLHAS explícitas (`picked[itemId]` = `sourceChoiceKey`; ausente ou
 * "" = não usar). Envia o valor ATUAL que a pessoa viu (R9 / SEM-049) para o servidor recusar se mudou.
 */
export function bulkAdoptChanges(rows: readonly AdoptableRow[], picked: Readonly<Record<string, string>>) {
  const out: Array<{ itemId: string; expectedRevision: number; mode: "adopt_source"; sourceType: "price_research" | "dfd"; sourceId: string; expectedSourceQuantity: number }> = [];
  for (const r of rows) {
    const s = r.sources.find((x) => sourceChoiceKey(x) === picked[r.item.id]);
    const v = s ? adoptableSourceValue(s) : null;
    if (!s || v === null) continue;
    out.push({ itemId: r.item.id, expectedRevision: r.item.revision, mode: "adopt_source", sourceType: s.sourceType as "price_research" | "dfd", sourceId: s.sourceId, expectedSourceQuantity: v });
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

/** INV-16 — formatador monetário ÚNICO (centavos → "R$ 1.234,56"). */
export function brl(cents: number): string {
  return formatCentsBRL(cents);
}

/**
 * R9 / SEM-030 — estado GOVERNADO do Item Inteligente no painel de candidatos: aprovar a EXTRAÇÃO não é aprovar o ITEM.
 */
export function candidateEvidenceText(e: { status: string; sourceState: string; averagePriceCents: number | null; quoteCount: number }): string {
  const status = e.status === "aprovado" ? "aprovado" : e.status === "rejeitado" ? "rejeitado" : "aguardando decisão humana";
  const fonte = e.sourceState === "current" ? "fonte vigente" : "fonte alterada — revisar";
  const preco = e.averagePriceCents !== null && e.quoteCount > 0 ? `preço médio ${brl(e.averagePriceCents)} (${e.quoteCount} cotação(ões))` : "sem preço";
  return `Item Inteligente: ${status} · ${fonte} · ${preco}`;
}
