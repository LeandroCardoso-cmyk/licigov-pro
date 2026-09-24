/**
 * Pesquisa de Preços — revisão ITEM-CÊNTRICA: contadores (itens × cotações, em níveis separados), lista de itens
 * lógicos com cotações recolhidas, seleção de itens e decisão por item com CONFIRMAÇÃO explícita do que será
 * afetado. A decisão por item é uma única mutation atômica no servidor (nunca um laço de mutations no browser).
 * Linhas sem item identificado continuam visíveis e revisáveis individualmente.
 */
import React, { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { INSTITUTIONAL_COPY } from "@/lib/ingestion/status";
import {
  canDecideGroup, groupDecisionSummary, itemsLabel, reviewCounters, toggleExpanded,
  type GroupReviewAction, type PriceResearchReview, type PriceResearchReviewGroup, type PriceResearchReviewQuote,
} from "@/lib/ingestion/priceResearchReview";
import { PriceResearchItemCard, PriceResearchQuoteRow } from "./PriceResearchItemCard";

export function PriceResearchReviewSummary({ counts, sessionId, procurementProcessId }: {
  counts: PriceResearchReview["counts"]; sessionId?: number | null; procurementProcessId?: string | null;
}) {
  const c = reviewCounters(counts);
  return (
    <div className="space-y-2" data-testid="price-research-review-summary">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {c.primary.map((s) => (
          <div key={s.key} className="rounded-md border border-border bg-card p-2 text-center" data-testid={`price-research-counter-${s.key}`}>
            <div className={cn("text-lg font-semibold text-foreground",
              s.key === "pending" && "text-amber-700 dark:text-amber-300",
              s.key === "reviewed" && "text-green-700 dark:text-green-300",
              s.key === "rejected" && "text-red-700 dark:text-red-300")}>{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {c.quoteLine}
        {sessionId != null && <> · Sessão <code className="font-mono">#{sessionId}</code></>}
        {procurementProcessId != null && <> · Processo <code className="font-mono">{procurementProcessId}</code></>}
      </p>
    </div>
  );
}

interface PendingDecision { action: GroupReviewAction; groups: PriceResearchReviewGroup[] }

interface ListProps {
  review: PriceResearchReview;
  disabled?: boolean;
  isDeciding?: boolean;
  decisionError?: string | null;
  /** Estado inicial de expansão (por padrão tudo recolhido). */
  initialExpanded?: readonly string[];
  onDecideGroups: (action: GroupReviewAction, groups: { groupKey: string; expectedRevision: string }[]) => Promise<unknown> | void;
  onReviewQuote: (stagingRowId: number, action: GroupReviewAction) => void;
  onOpenQuote: (quote: PriceResearchReviewQuote) => void;
}

export function PriceResearchReviewList({
  review, disabled, isDeciding, decisionError, initialExpanded, onDecideGroups, onReviewQuote, onOpenQuote,
}: ListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded ?? []));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingDecision | null>(null);

  const decidable = useMemo(() => review.groups.filter(canDecideGroup), [review.groups]);
  const selectedGroups = useMemo(() => decidable.filter((g) => selected.has(g.groupKey)), [decidable, selected]);
  const allSelected = decidable.length > 0 && decidable.every((g) => selected.has(g.groupKey));

  function toggleSelected(key: string) { setSelected((prev) => toggleExpanded(prev, key)); }
  async function confirm() {
    if (!pending) return;
    await onDecideGroups(pending.action, pending.groups.map((g) => ({ groupKey: g.groupKey, expectedRevision: g.revision })));
    setPending(null);
    setSelected(new Set());
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{INSTITUTIONAL_COPY.humanReviewRequired}</p>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{itemsLabel(review.counts.logicalItems)} para revisar</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" disabled={disabled || decidable.length === 0}
            onClick={() => setSelected(allSelected ? new Set() : new Set(decidable.map((g) => g.groupKey)))}>
            {allSelected ? "Limpar seleção" : "Selecionar itens pendentes"}
          </Button>
          {selectedGroups.length > 0 && (
            <>
              <Button size="sm" variant="outline" disabled={disabled} onClick={() => setPending({ action: "approved", groups: selectedGroups })}>
                Aceitar {itemsLabel(selectedGroups.length)}
              </Button>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => setPending({ action: "rejected", groups: selectedGroups })}>
                Rejeitar {itemsLabel(selectedGroups.length)}
              </Button>
            </>
          )}
        </div>
      </div>

      {pending && (
        <Alert role="alertdialog" aria-label="Confirmar decisão por item">
          <AlertTitle>{pending.action === "approved" ? "Aceitar" : "Rejeitar"} {itemsLabel(pending.groups.length)}?</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{groupDecisionSummary(pending.action, pending.groups)}</p>
            <div className="flex gap-2">
              <Button size="sm" disabled={isDeciding} onClick={() => void confirm()}>{isDeciding ? "Registrando…" : "Confirmar"}</Button>
              <Button size="sm" variant="ghost" disabled={isDeciding} onClick={() => setPending(null)}>Cancelar</Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {decisionError && <p className="text-sm text-destructive" role="alert">{decisionError}</p>}

      <div className="space-y-2" data-testid="price-research-item-list">
        {review.groups.map((g) => (
          <PriceResearchItemCard
            key={g.groupKey}
            group={g}
            expanded={expanded.has(g.groupKey)}
            selected={selected.has(g.groupKey)}
            disabled={disabled || isDeciding}
            onToggleExpanded={(k) => setExpanded((prev) => toggleExpanded(prev, k))}
            onToggleSelected={toggleSelected}
            onDecide={(group, action) => setPending({ action, groups: [group] })}
            onReviewQuote={onReviewQuote}
            onOpenQuote={onOpenQuote}
          />
        ))}
      </div>

      {review.unassignedQuotes.length > 0 && (
        <section aria-label="Registros sem item identificado" className="space-y-2 rounded-md border border-amber-300 p-3 dark:border-amber-800">
          <p className="flex items-center gap-1 text-sm font-medium text-amber-800 dark:text-amber-200">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {review.unassignedQuotes.length} registro(s) sem item identificado (sem descrição) — revise individualmente.
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {review.unassignedQuotes.map((q) => (
              <PriceResearchQuoteRow key={q.stagingRowId} quote={q} disabled={disabled || isDeciding} onReviewQuote={onReviewQuote} onOpenQuote={onOpenQuote} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
