import { useMemo, useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import {
  groupItems, originLabel, formatQty, plannedQuantityLabel, provenanceLines, sourceQuantityLabel, adoptableQuantities,
  quantityInputError, brl, CANDIDATE_STATUS_LABELS, type ItemView, type LotView,
} from "./procurementItemsView";
import { shouldRotateAssistKeyOnError } from "./dfdFieldSources";

/**
 * Itens da contratação — área TRANSVERSAL do processo (qualquer etapa de início). O sistema encontra os itens
 * (Pesquisa de Preços revisada, DFD) e o servidor só confere e informa o que falta — normalmente a
 * quantidade PREVISTA. Quantidade do documento é evidência: vira prevista só com "Usar N" explícito.
 * Lotes são opcionais. Nada aqui aprova documento; toda escrita é governada no servidor.
 */

const BTN_PRIMARY = "rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground";
const BTN = "rounded-lg border border-input px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground";
const BTN_SM = "rounded-md border border-input px-2 py-0.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground";
const INPUT = "rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const newKey = () => crypto.randomUUID();

export type ProcurementItemsWorkspaceProps = { processId?: string };

export default function ProcurementItemsWorkspace({ processId = "" }: ProcurementItemsWorkspaceProps) {
  const utils = trpc.useUtils();
  const { data, isLoading, isError, refetch } = trpc.procurementItems.workspace.useQuery({ processId }, { enabled: !!processId });
  const [preparing, setPreparing] = useState<null | "price_research" | "dfd">(null);
  const [showManual, setShowManual] = useState(false);
  const [showLot, setShowLot] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    if (!processId) return;
    utils.procurementItems.workspace.invalidate({ processId });
    utils.procurementItems.candidates.invalidate();
    utils.procurementProcess.dfdAssistState.invalidate({ processId });
    utils.procurementProcess.canonicalContext.invalidate({ processId });
  };
  const onError = (e: { message: string; data?: { code?: string } | null }) => {
    setError(e.message);
    if (e.data?.code === "CONFLICT") invalidate();
  };

  if (isLoading) {
    return <div className="mx-auto max-w-5xl p-6"><div className="h-32 animate-pulse rounded-xl bg-muted" /></div>;
  }
  if (isError || !data) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <p className="text-sm text-destructive">Não foi possível carregar os itens da contratação.</p>
        <button type="button" className={`${BTN} mt-2`} onClick={() => refetch()}>Tentar novamente</button>
      </div>
    );
  }

  const items = data.items as ItemView[];
  const lots = data.lots as LotView[];
  const locked = data.governance.locked;
  const groups = groupItems(items, lots);
  const adoptable = adoptableQuantities(items);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Itens da contratação</h1>
          <p className="text-sm text-muted-foreground">
            O que será contratado neste processo. Confira os itens identificados e informe a quantidade prevista.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          {data.stats.itemCount} {data.stats.itemCount === 1 ? "item" : "itens"}
        </span>
      </div>

      {locked && (
        <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {data.governance.reason}
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" className={BTN_SM} onClick={() => setError(null)}>Fechar</button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {data.sources.priceResearchItems > 0 && (
          <button type="button" className={BTN_PRIMARY} disabled={locked} onClick={() => { setPreparing("price_research"); setError(null); }}>
            Preparar a partir da pesquisa
          </button>
        )}
        {data.sources.dfdRows > 0 && (
          <button type="button" className={BTN} disabled={locked} onClick={() => { setPreparing("dfd"); setError(null); }}>
            Preparar a partir do DFD
          </button>
        )}
        <button type="button" className={BTN} disabled={locked} onClick={() => setShowManual((v) => !v)}>+ Adicionar item</button>
        <button type="button" className={BTN} disabled={locked} onClick={() => setShowLot((v) => !v)}>+ Criar lote</button>
        {adoptable.length > 0 && (
          <button type="button" className={BTN} disabled={locked} onClick={() => setShowBulk((v) => !v)}>Usar quantidades do documento</button>
        )}
      </div>

      {data.sources.priceResearchItems > 0 && items.length === 0 && !preparing && (
        <p className="text-sm text-muted-foreground">
          {data.sources.priceResearchItems} item(ns) identificado(s) na Pesquisa de Preços. Use “Preparar a partir da pesquisa” para aproveitá-los.
        </p>
      )}

      {preparing && (
        <CandidatesPanel processId={processId} source={preparing} lots={lots} items={items}
          onClose={() => setPreparing(null)} onDone={() => { setPreparing(null); invalidate(); }} onError={onError} />
      )}
      {showBulk && (
        <BulkAdoptPanel processId={processId} rows={adoptable} onClose={() => setShowBulk(false)}
          onDone={() => { setShowBulk(false); invalidate(); }} onError={onError} />
      )}
      {showManual && (
        <ManualItemForm processId={processId} lots={lots} onClose={() => setShowManual(false)}
          onDone={() => { setShowManual(false); invalidate(); }} onError={onError} />
      )}
      {showLot && (
        <LotForm processId={processId} onClose={() => setShowLot(false)} onDone={() => { setShowLot(false); invalidate(); }} onError={onError} />
      )}

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nenhum item da contratação ainda. Prepare a partir de um documento já revisado ou adicione manualmente.
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.lot?.id ?? "none"} className="rounded-xl border border-border bg-card" aria-label={g.title || "Itens"}>
            {(g.title || g.lot) && (
              <LotHeader processId={processId} group={g} lots={lots} locked={locked} onDone={invalidate} onError={onError} />
            )}
            {g.items.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Nenhum item neste lote.</p>
            ) : (
              <ol className="divide-y divide-border">
                {g.items.map((it) => (
                  <ItemRow key={it.id} processId={processId} item={it} number={items.indexOf(it) + 1} lots={lots} locked={locked} onDone={invalidate} onError={onError} />
                ))}
              </ol>
            )}
          </section>
        ))
      )}

      {items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Não encontrou um item? Use “+ Adicionar item” — o item fica registrado como informado manualmente, sem alterar a Pesquisa de Preços.
          {data.estimatedTotalCents !== null && ` Estimativa preliminar (quantidade prevista × preço de referência de cada item): ${brl(data.estimatedTotalCents)}.`}
        </p>
      )}
    </div>
  );
}

// ─── Linha do item ────────────────────────────────────────────────────────────────────────

function ItemRow({ processId, item, number, lots, locked, onDone, onError }: {
  processId: string; item: ItemView; number: number; lots: LotView[]; locked: boolean;
  onDone: () => void; onError: (e: { message: string; data?: { code?: string } | null }) => void;
}) {
  const [qty, setQty] = useState(formatQty(item.plannedQuantity.value));
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(item.description);
  const [unit, setUnit] = useState(item.unit);
  const [showOrigin, setShowOrigin] = useState(false);
  const opts = { onSuccess: onDone, onError };
  const setQuantities = trpc.procurementItems.setQuantities.useMutation(opts);
  const updateItem = trpc.procurementItems.updateItem.useMutation({ ...opts, onSuccess: () => { setEditing(false); onDone(); } });
  const assignLot = trpc.procurementItems.assignLot.useMutation(opts);
  const moveItem = trpc.procurementItems.moveItem.useMutation(opts);
  const withdraw = trpc.procurementItems.withdrawItem.useMutation(opts);
  const busy = setQuantities.isPending || updateItem.isPending || assignLot.isPending || moveItem.isPending || withdraw.isPending;
  const qtyError = quantityInputError(qty);
  const qtyChanged = qty.trim() !== formatQty(item.plannedQuantity.value);
  const base = { processId, itemId: item.id, expectedRevision: item.revision };

  return (
    <li className="space-y-2 px-4 py-3" data-item={item.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">Item {String(number).padStart(3, "0")} · Origem: {originLabel(item.origin)}</p>
          {editing ? (
            <div className="mt-1 grid gap-2 sm:grid-cols-[1fr_8rem]">
              <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Descrição</span>
                <input className={INPUT} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} /></label>
              <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Unidade</span>
                <input className={INPUT} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} /></label>
            </div>
          ) : (
            <p className="font-medium text-foreground">{item.description}</p>
          )}
          {!editing && <p className="text-sm text-muted-foreground">Unidade: {item.unit}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {editing ? (
            <>
              <button type="button" className={BTN_SM} disabled={busy || !desc.trim() || !unit.trim()}
                onClick={() => updateItem.mutate({ ...base, description: desc, unit, idempotencyKey: newKey() })}>Salvar</button>
              <button type="button" className={BTN_SM} onClick={() => { setEditing(false); setDesc(item.description); setUnit(item.unit); }}>Cancelar</button>
            </>
          ) : (
            <button type="button" className={BTN_SM} disabled={locked || busy} onClick={() => setEditing(true)}>Editar</button>
          )}
          <button type="button" className={BTN_SM} aria-label="Mover para cima" disabled={locked || busy} onClick={() => moveItem.mutate({ ...base, direction: "up", idempotencyKey: newKey() })}>↑</button>
          <button type="button" className={BTN_SM} aria-label="Mover para baixo" disabled={locked || busy} onClick={() => moveItem.mutate({ ...base, direction: "down", idempotencyKey: newKey() })}>↓</button>
          <button type="button" className={BTN_SM} disabled={locked || busy} onClick={() => {
            const reason = window.prompt("Motivo da retirada do item (o histórico é preservado):");
            if (reason && reason.trim()) withdraw.mutate({ ...base, reason, idempotencyKey: newKey() });
          }}>Retirar</button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs">
          <span className="mb-1 text-muted-foreground">Quantidade prevista</span>
          <span className="flex items-center gap-2">
            <input className={`${INPUT} w-32`} inputMode="decimal" value={qty} placeholder="Não definida"
              aria-invalid={qtyError ? true : undefined} onChange={(e) => setQty(e.target.value)} disabled={locked} />
            {qtyChanged && (
              <button type="button" className={BTN_SM} disabled={busy || !!qtyError}
                onClick={() => setQuantities.mutate({ processId, idempotencyKey: newKey(), changes: [{ ...base, mode: "informed", quantity: qty.trim() || null }] })}>
                Salvar quantidade
              </button>
            )}
          </span>
          {qtyError && <span className="mt-1 text-destructive">{qtyError}</span>}
        </label>
        {!qtyChanged && (
          <span className={`text-sm ${item.plannedQuantity.value === null ? "italic text-muted-foreground" : "text-foreground"}`}>
            {plannedQuantityLabel(item.plannedQuantity)}
          </span>
        )}
        {item.sources.filter((s) => s.sourceQuantity !== null).map((s) => (
          <span key={`${s.sourceType}:${s.sourceId}`} className="flex items-center gap-2 text-sm text-muted-foreground">
            {sourceQuantityLabel(s)}
            {s.sourceQuantity !== item.plannedQuantity.value && (
              <button type="button" className={BTN_SM} disabled={locked || busy}
                onClick={() => setQuantities.mutate({ processId, idempotencyKey: newKey(), changes: [{ ...base, mode: "adopt_source", sourceType: s.sourceType as "price_research" | "dfd", sourceId: s.sourceId }] })}>
                Usar {formatQty(s.sourceQuantity)}
              </button>
            )}
          </span>
        ))}
        {lots.length > 0 && (
          <label className="flex flex-col text-xs">
            <span className="mb-1 text-muted-foreground">Lote</span>
            <select className={INPUT} value={item.lotId ?? ""} disabled={locked || busy}
              onChange={(e) => assignLot.mutate({ ...base, lotId: e.target.value || null, idempotencyKey: newKey() })}>
              <option value="">Sem lote</option>
              {lots.map((l) => <option key={l.id} value={l.id}>Lote {l.code} — {l.name}</option>)}
            </select>
          </label>
        )}
        {item.estimatedTotalCents !== null && (
          <span className="text-sm text-muted-foreground">Estimativa: {brl(item.estimatedTotalCents)}</span>
        )}
        {item.priceAmbiguous && (
          <span className="text-xs text-amber-700 dark:text-amber-300">Preços de referência divergentes entre as pesquisas vinculadas — revise na Pesquisa de Preços.</span>
        )}
      </div>

      <button type="button" className="text-xs text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={showOrigin} onClick={() => setShowOrigin((v) => !v)}>
        {showOrigin ? "Ocultar origem" : "Ver origem das informações"}
      </button>
      {showOrigin && (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {provenanceLines(item).map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
    </li>
  );
}

// ─── Cabeçalho de lote ────────────────────────────────────────────────────────────────────

function LotHeader({ processId, group, lots, locked, onDone, onError }: {
  processId: string; group: ReturnType<typeof groupItems>[number]; lots: LotView[]; locked: boolean;
  onDone: () => void; onError: (e: { message: string; data?: { code?: string } | null }) => void;
}) {
  const lot = group.lot;
  const opts = { onSuccess: onDone, onError };
  const moveLot = trpc.procurementItems.moveLot.useMutation(opts);
  const updateLot = trpc.procurementItems.updateLot.useMutation(opts);
  const archiveLot = trpc.procurementItems.archiveLot.useMutation(opts);
  const busy = moveLot.isPending || updateLot.isPending || archiveLot.isPending;
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
      <div>
        <h2 className="text-sm font-semibold text-foreground">{group.title}</h2>
        {lot?.description && <p className="text-xs text-muted-foreground">{lot.description}</p>}
      </div>
      {lot && (
        <div className="flex flex-wrap gap-1">
          <button type="button" className={BTN_SM} aria-label="Mover lote para cima" disabled={locked || busy || lots[0]?.id === lot.id}
            onClick={() => moveLot.mutate({ processId, lotId: lot.id, expectedRevision: lot.revision, direction: "up", idempotencyKey: newKey() })}>↑</button>
          <button type="button" className={BTN_SM} aria-label="Mover lote para baixo" disabled={locked || busy || lots[lots.length - 1]?.id === lot.id}
            onClick={() => moveLot.mutate({ processId, lotId: lot.id, expectedRevision: lot.revision, direction: "down", idempotencyKey: newKey() })}>↓</button>
          <button type="button" className={BTN_SM} disabled={locked || busy} onClick={() => {
            const name = window.prompt("Novo nome do lote:", lot.name);
            if (name && name.trim() && name.trim() !== lot.name) updateLot.mutate({ processId, lotId: lot.id, expectedRevision: lot.revision, name, idempotencyKey: newKey() });
          }}>Renomear</button>
          <button type="button" className={BTN_SM} disabled={locked || busy || group.items.length > 0}
            title={group.items.length > 0 ? "Mova os itens antes de arquivar o lote." : undefined}
            onClick={() => {
              const reason = window.prompt("Motivo do arquivamento do lote:");
              if (reason && reason.trim()) archiveLot.mutate({ processId, lotId: lot.id, expectedRevision: lot.revision, reason, idempotencyKey: newKey() });
            }}>Arquivar</button>
        </div>
      )}
    </header>
  );
}

// ─── Preparar a partir de uma fonte (candidatos) ───────────────────────────────────────────

type Decision = {
  include: boolean; action: "create" | "link"; linkTo: string; description: string; unit: string;
  quantity: string; adopt: boolean; lot: string; // "" = sem lote; "source" = estrutura da fonte; id = lote existente
};

export function CandidatesPanel({ processId, source, lots, items, onClose, onDone, onError }: {
  processId: string; source: "price_research" | "dfd"; lots: LotView[]; items: ItemView[];
  onClose: () => void; onDone: () => void; onError: (e: { message: string; data?: { code?: string } | null }) => void;
}) {
  const { data, isLoading } = trpc.procurementItems.candidates.useQuery({ processId, source });
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const { key, rotate } = useIdempotencyKey();
  const confirm = trpc.procurementItems.confirmCandidates.useMutation({
    onSuccess: () => { rotate(); onDone(); },
    onError: (e) => { if (shouldRotateAssistKeyOnError(e.data?.code)) rotate(); onError(e); },
  });
  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const get = (c: (typeof candidates)[number]): Decision => decisions[c.candidateKey] ?? {
    include: c.match.status === "new" && !c.duplicateOfCandidateKey,
    action: c.match.status === "possible_match" ? "link" : "create",
    linkTo: c.match.candidateItemIds[0] ?? "",
    description: c.description, unit: c.unit, quantity: "", adopt: false,
    lot: c.sourceLotCode ? "source" : "",
  };
  const set = (k: string, d: Partial<Decision>, c: (typeof candidates)[number]) => setDecisions((m) => ({ ...m, [k]: { ...get(c), ...d } }));
  const usable = candidates.filter((c) => c.match.status !== "linked" && c.match.status !== "blocked");
  const chosen = usable.filter((c) => get(c).include);
  const invalid = chosen.some((c) => { const d = get(c); return d.action === "create" && (!!quantityInputError(d.quantity) || !d.description.trim() || !d.unit.trim()); });

  const submit = () => {
    if (!data) return;
    confirm.mutate({
      processId, source, expectedSourceDigest: data.sourceDigest, idempotencyKey: key,
      decisions: usable.map((c) => {
        const d = get(c);
        if (!d.include) return { candidateKey: c.candidateKey, action: "skip" as const };
        if (d.action === "link") return { candidateKey: c.candidateKey, action: "link" as const, canonicalItemId: d.linkTo };
        return {
          candidateKey: c.candidateKey, action: "create" as const,
          description: d.description, unit: d.unit,
          ...(d.adopt ? { adoptSourceQuantity: true } : { plannedQuantity: d.quantity.trim() || null }),
          lot: d.lot === "source" ? { kind: "source" as const } : d.lot ? { kind: "existing" as const, lotId: d.lot } : { kind: "none" as const },
        };
      }),
    });
  };

  return (
    <section className="rounded-xl border border-primary/30 bg-card p-4" aria-label="Itens identificados">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium text-foreground">Itens identificados {source === "price_research" ? "na Pesquisa de Preços" : "no DFD"}</h2>
        <button type="button" className={BTN_SM} onClick={onClose}>Fechar</button>
      </div>
      {isLoading || !data ? (
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
      ) : candidates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum item identificado nesta fonte.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {data.counts.sourceItemCount} item(ns) identificado(s). Descrição e unidade já vêm preenchidas — normalmente você só informa a quantidade prevista.
          </p>
          <ul className="space-y-3">
            {candidates.map((c) => {
              const d = get(c);
              const frozen = c.match.status === "linked" || c.match.status === "blocked";
              return (
                <li key={c.candidateKey} className="rounded-lg border border-border p-3" data-candidate={c.candidateKey} data-status={c.match.status}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <input type="checkbox" checked={!frozen && d.include} disabled={frozen} onChange={(e) => set(c.candidateKey, { include: e.target.checked }, c)} />
                      {c.description}
                    </label>
                    <span className="text-xs text-muted-foreground">{CANDIDATE_STATUS_LABELS[c.match.status]}</span>
                  </div>
                  {c.match.reason && c.match.status === "blocked" && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{c.match.reason}</p>}
                  {c.duplicateOfCandidateKey && <p className="mt-1 text-xs text-muted-foreground">Mesma descrição e unidade de outra linha desta fonte (ex.: cotada com outra quantidade).</p>}
                  {!frozen && d.include && (
                    <div className="mt-2 space-y-2">
                      {(c.match.status === "possible_match" || c.match.status === "ambiguous") && (
                        <fieldset className="flex flex-wrap items-center gap-3 text-sm">
                          <legend className="sr-only">Associar ou criar</legend>
                          <label className="flex items-center gap-1"><input type="radio" checked={d.action === "link"} onChange={() => set(c.candidateKey, { action: "link" }, c)} />Associar ao existente</label>
                          {d.action === "link" && (
                            <select className={INPUT} value={d.linkTo} onChange={(e) => set(c.candidateKey, { linkTo: e.target.value }, c)}>
                              {c.match.candidateItemIds.map((id) => <option key={id} value={id}>{items.find((i) => i.id === id)?.description ?? id}</option>)}
                            </select>
                          )}
                          <label className="flex items-center gap-1"><input type="radio" checked={d.action === "create"} onChange={() => set(c.candidateKey, { action: "create" }, c)} />Criar como novo</label>
                        </fieldset>
                      )}
                      {d.action === "create" && (
                        <div className="grid gap-2 sm:grid-cols-[1fr_8rem_10rem]">
                          <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Descrição</span>
                            <input className={INPUT} value={d.description} onChange={(e) => set(c.candidateKey, { description: e.target.value }, c)} /></label>
                          <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Unidade</span>
                            <input className={INPUT} value={d.unit} onChange={(e) => set(c.candidateKey, { unit: e.target.value }, c)} /></label>
                          <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Quantidade prevista</span>
                            <input className={INPUT} inputMode="decimal" placeholder="Não definida" value={d.adopt ? formatQty(c.sourceQuantity) : d.quantity}
                              disabled={d.adopt} onChange={(e) => set(c.candidateKey, { quantity: e.target.value }, c)} />
                            {quantityInputError(d.quantity) && !d.adopt && <span className="mt-1 text-destructive">{quantityInputError(d.quantity)}</span>}
                          </label>
                        </div>
                      )}
                      {d.action === "create" && c.sourceQuantity !== null && (
                        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                          {source === "dfd" ? "Quantidade no DFD" : "Quantidade no documento"}: {formatQty(c.sourceQuantity)}
                          <label className="flex items-center gap-1 text-foreground">
                            <input type="checkbox" checked={d.adopt} onChange={(e) => set(c.candidateKey, { adopt: e.target.checked, quantity: "" }, c)} />
                            Usar {formatQty(c.sourceQuantity)} como quantidade prevista
                          </label>
                        </p>
                      )}
                      {d.action === "create" && (c.sourceLotCode || lots.length > 0) && (
                        <label className="flex flex-col text-xs">
                          <span className="mb-1 text-muted-foreground">{c.sourceLotCode ? `Lote identificado na fonte: ${c.sourceLotCode}` : "Lote não identificado na fonte"}</span>
                          <select className={INPUT} value={d.lot} onChange={(e) => set(c.candidateKey, { lot: e.target.value }, c)}>
                            {c.sourceLotCode && <option value="source">Usar estrutura identificada (Lote {c.sourceLotCode})</option>}
                            <option value="">Sem lote</option>
                            {lots.map((l) => <option key={l.id} value={l.id}>Lote {l.code} — {l.name}</option>)}
                          </select>
                        </label>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className={BTN_PRIMARY} disabled={confirm.isPending || chosen.length === 0 || invalid} onClick={submit}>
              {confirm.isPending ? "Confirmando..." : `Confirmar ${chosen.length} item(ns)`}
            </button>
            <span className="text-xs text-muted-foreground">Nada é gravado até a confirmação. A Pesquisa de Preços não é alterada.</span>
          </div>
        </>
      )}
    </section>
  );
}

// ─── "Usar quantidades do documento" (preview + confirmação) ──────────────────────────────

function BulkAdoptPanel({ processId, rows, onClose, onDone, onError }: {
  processId: string; rows: ReturnType<typeof adoptableQuantities>;
  onClose: () => void; onDone: () => void; onError: (e: { message: string; data?: { code?: string } | null }) => void;
}) {
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const set = trpc.procurementItems.setQuantities.useMutation({ onSuccess: onDone, onError });
  const chosen = rows.filter((r) => picked[r.item.id] !== false);
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Usar quantidades do documento">
      <h2 className="font-medium text-foreground">Usar quantidades do documento</h2>
      <p className="mb-2 text-sm text-muted-foreground">Confira a lista. Só os itens marcados terão a quantidade do documento adotada como quantidade prevista.</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.item.id}>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={picked[r.item.id] !== false} onChange={(e) => setPicked((m) => ({ ...m, [r.item.id]: e.target.checked }))} />
              {r.item.description} — {sourceQuantityLabel(r.source)}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={set.isPending || chosen.length === 0}
          onClick={() => set.mutate({ processId, idempotencyKey: newKey(), changes: chosen.map((r) => ({ itemId: r.item.id, expectedRevision: r.item.revision, mode: "adopt_source" as const, sourceType: r.source.sourceType as "price_research" | "dfd", sourceId: r.source.sourceId })) })}>
          Confirmar {chosen.length} item(ns)
        </button>
        <button type="button" className={BTN} onClick={onClose}>Cancelar</button>
      </div>
    </section>
  );
}

// ─── Formulários ───────────────────────────────────────────────────────────────────────────

function ManualItemForm({ processId, lots, onClose, onDone, onError }: {
  processId: string; lots: LotView[]; onClose: () => void; onDone: () => void;
  onError: (e: { message: string; data?: { code?: string } | null }) => void;
}) {
  const [f, setF] = useState({ description: "", unit: "", quantity: "", lotId: "", reason: "" });
  const { key, rotate } = useIdempotencyKey();
  const create = trpc.procurementItems.createManual.useMutation({
    onSuccess: () => { rotate(); onDone(); },
    onError: (e) => { if (shouldRotateAssistKeyOnError(e.data?.code)) rotate(); onError(e); },
  });
  const qErr = quantityInputError(f.quantity);
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Adicionar item manualmente">
      <h2 className="font-medium text-foreground">Adicionar item manualmente</h2>
      <p className="mb-3 text-sm text-muted-foreground">Use quando o item não foi identificado automaticamente. Ele fica registrado como informado manualmente.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col text-xs sm:col-span-2"><span className="mb-1 text-muted-foreground">Descrição *</span>
          <input className={INPUT} value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Unidade *</span>
          <input className={INPUT} value={f.unit} maxLength={30} onChange={(e) => setF({ ...f, unit: e.target.value })} /></label>
        <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Quantidade prevista</span>
          <input className={INPUT} inputMode="decimal" placeholder="Não definida" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          {qErr && <span className="mt-1 text-destructive">{qErr}</span>}</label>
        {lots.length > 0 && (
          <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Lote</span>
            <select className={INPUT} value={f.lotId} onChange={(e) => setF({ ...f, lotId: e.target.value })}>
              <option value="">Sem lote</option>
              {lots.map((l) => <option key={l.id} value={l.id}>Lote {l.code} — {l.name}</option>)}
            </select></label>
        )}
        <label className="flex flex-col text-xs sm:col-span-2"><span className="mb-1 text-muted-foreground">Motivo / contexto (opcional)</span>
          <input className={INPUT} value={f.reason} maxLength={500} placeholder="Item não identificado automaticamente no documento." onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={create.isPending || !f.description.trim() || !f.unit.trim() || !!qErr}
          onClick={() => create.mutate({ processId, description: f.description, unit: f.unit, plannedQuantity: f.quantity.trim() || null, lotId: f.lotId || null, reason: f.reason || null, idempotencyKey: key })}>
          {create.isPending ? "Adicionando..." : "Adicionar item"}
        </button>
        <button type="button" className={BTN} onClick={onClose}>Cancelar</button>
      </div>
    </section>
  );
}

function LotForm({ processId, onClose, onDone, onError }: {
  processId: string; onClose: () => void; onDone: () => void;
  onError: (e: { message: string; data?: { code?: string } | null }) => void;
}) {
  const [f, setF] = useState({ code: "", name: "", description: "" });
  const create = trpc.procurementItems.createLot.useMutation({ onSuccess: onDone, onError });
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Criar lote">
      <h2 className="font-medium text-foreground">Criar lote</h2>
      <p className="mb-3 text-sm text-muted-foreground">Lotes são opcionais. Itens podem ficar sem lote até a estruturação ser concluída.</p>
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
        <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Código *</span>
          <input className={INPUT} placeholder="01" value={f.code} maxLength={40} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
        <label className="flex flex-col text-xs"><span className="mb-1 text-muted-foreground">Nome *</span>
          <input className={INPUT} placeholder="Materiais de limpeza" value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="flex flex-col text-xs sm:col-span-2"><span className="mb-1 text-muted-foreground">Descrição (opcional)</span>
          <input className={INPUT} value={f.description} maxLength={2000} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className={BTN_PRIMARY} disabled={create.isPending || !f.code.trim() || !f.name.trim()}
          onClick={() => create.mutate({ processId, code: f.code, name: f.name, description: f.description || null, idempotencyKey: newKey() })}>
          {create.isPending ? "Criando..." : "Criar lote"}
        </button>
        <button type="button" className={BTN} onClick={onClose}>Cancelar</button>
      </div>
    </section>
  );
}
