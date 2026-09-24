/**
 * Pesquisa de Preços — ITEM LÓGICO na revisão (entidade principal) com as COTAÇÕES subordinadas.
 *
 * Mostra de início: descrição (uma vez), quantidade, unidade, preço médio, nº de cotações, status, reconciliação
 * (média do documento × calculada) e advertências relevantes. As cotações (evidências individuais, auditáveis)
 * ficam recolhidas e aparecem ao expandir, cada uma com fonte REAL, valor, status e ações próprias.
 * Acessível (botões nativos, aria-expanded/aria-controls) e compatível com dark mode; sem scroll horizontal.
 */
import React from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Eye, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  GROUP_STATUS_LABEL, GROUP_STATUS_TONE, QUOTE_STATUS_LABEL, canDecideGroup, formatMoney, formatQuantity,
  formatQuoteLineage, mainAverage, quoteSourceLabel, quotesLabel, reconciliationView, splitWarnings,
  type GroupReviewAction, type PriceResearchReviewGroup, type PriceResearchReviewQuote,
} from "@/lib/ingestion/priceResearchReview";

interface QuoteRowProps {
  quote: PriceResearchReviewQuote;
  disabled?: boolean;
  onReviewQuote: (stagingRowId: number, action: GroupReviewAction) => void;
  onOpenQuote: (quote: PriceResearchReviewQuote) => void;
}

/** Uma COTAÇÃO (evidência individual). Layout em grade que se reorganiza em telas estreitas. */
export function PriceResearchQuoteRow({ quote, disabled, onReviewQuote, onOpenQuote }: QuoteRowProps) {
  const source = quoteSourceLabel(quote);
  const { operational } = splitWarnings(quote.warnings);
  const isPending = quote.status === "pending";
  const where = formatQuoteLineage(quote.lineage);
  return (
    <li data-testid="price-research-quote" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_6rem_auto]">
      <div className="min-w-0">
        <p className={cn("truncate text-sm", !quote.sourceResolved && "italic text-muted-foreground")} title={source}>
          {!quote.sourceResolved && <AlertTriangle className="mr-1 inline size-3 text-amber-600 dark:text-amber-400" aria-hidden="true" />}
          {source}
        </p>
        {where && <p className="text-xs text-muted-foreground">{where}{quote.corrected ? " · corrigida" : ""}</p>}
        {operational.length > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-300">{operational.map((w) => w.message).join(" · ")}</p>
        )}
      </div>
      <p className="text-right text-sm font-medium tabular-nums">
        {quote.amountCents != null ? formatMoney(quote.amountCents) : <span className="text-muted-foreground" title={quote.rawAmount ?? ""}>sem valor válido</span>}
      </p>
      <Badge variant="outline" className="justify-self-start sm:justify-self-auto">{QUOTE_STATUS_LABEL[quote.status]}</Badge>
      <div className="flex items-center justify-end gap-1">
        <Button size="sm" variant="ghost" disabled={disabled || !isPending} onClick={() => onReviewQuote(quote.stagingRowId, "approved")}
          aria-label={`Aceitar cotação de ${source}`}>Aceitar</Button>
        <Button size="sm" variant="ghost" disabled={disabled || !isPending} onClick={() => onReviewQuote(quote.stagingRowId, "rejected")}
          aria-label={`Rejeitar cotação de ${source}`}>Rejeitar</Button>
        <Button size="icon" variant="ghost" aria-label={`Detalhes da cotação de ${source}`} onClick={() => onOpenQuote(quote)}>
          <Eye className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

interface ItemCardProps {
  group: PriceResearchReviewGroup;
  expanded: boolean;
  selected: boolean;
  disabled?: boolean;
  onToggleExpanded: (groupKey: string) => void;
  onToggleSelected: (groupKey: string) => void;
  onDecide: (group: PriceResearchReviewGroup, action: GroupReviewAction) => void;
  onReviewQuote: (stagingRowId: number, action: GroupReviewAction) => void;
  onOpenQuote: (quote: PriceResearchReviewQuote) => void;
}

export function PriceResearchItemCard({
  group, expanded, selected, disabled, onToggleExpanded, onToggleSelected, onDecide, onReviewQuote, onOpenQuote,
}: ItemCardProps) {
  const titleId = `pr-item-${group.groupKey}-title`;
  const quotesId = `pr-item-${group.groupKey}-quotes`;
  const avg = mainAverage(group);
  const recon = reconciliationView(group);
  const { operational } = splitWarnings(group.warnings);
  const decidable = canDecideGroup(group);
  const ambiguous = group.identity.status === "ambiguous";

  return (
    <article data-testid="price-research-item" aria-labelledby={titleId} className="rounded-md border border-border bg-card text-card-foreground">
      <div className="flex items-start gap-3 p-3">
        <Checkbox
          className="mt-1"
          checked={selected}
          onCheckedChange={() => onToggleSelected(group.groupKey)}
          disabled={disabled || !decidable}
          aria-label={`Selecionar item: ${group.description}`}
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h4 id={titleId} className="min-w-0 break-words text-sm font-semibold leading-snug">{group.description}</h4>
            <Badge variant="outline" className={GROUP_STATUS_TONE[group.status]}>{GROUP_STATUS_LABEL[group.status]}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Qtd. <span className="tabular-nums">{formatQuantity(group.quantity)}</span> · {group.unit || "—"}
          </p>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <p className="text-sm">
              <span className="text-muted-foreground">{avg.label}: </span>
              <strong className="tabular-nums" data-testid="price-research-item-average">{formatMoney(avg.cents)}</strong>
            </p>
            <p className="text-sm text-muted-foreground" data-testid="price-research-item-quote-count">
              {quotesLabel(group.quoteCount)}
              {group.consideredQuoteCount !== group.quoteCount && <> · {group.consideredQuoteCount} considerada(s) na média</>}
            </p>
          </div>

          {/* Reconciliação: média impressa × calculada — ambas visíveis, nenhuma escolhida em silêncio. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" data-testid="price-research-item-reconciliation">
            {group.documentAverageCents != null && <span className="text-muted-foreground">Média do documento: <span className="tabular-nums">{formatMoney(group.documentAverageCents)}</span></span>}
            <span className="text-muted-foreground">Média calculada: <span className="tabular-nums">{formatMoney(group.extractedAverageCents)}</span></span>
            {recon.tone === "ok" && (
              <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-300"><CheckCircle2 className="size-3" aria-hidden="true" />{recon.label}</span>
            )}
            {recon.tone === "mismatch" && (
              <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="size-3" aria-hidden="true" />{recon.label}</span>
            )}
            {recon.tone === "unavailable" && <span className="text-muted-foreground">{recon.label}</span>}
          </div>

          {operational.length > 0 && (
            <ul className="space-y-0.5 text-xs text-amber-800 dark:text-amber-200" aria-label="Advertências do item">
              {operational.map((w) => (
                <li key={w.code} className="flex gap-1"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />{w.message}</li>
              ))}
            </ul>
          )}
          {ambiguous && (
            <p className="flex gap-1 text-xs text-muted-foreground"><Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />Decisão em lote indisponível para este item — decida as cotações individualmente.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
        <Button
          type="button" variant="ghost" size="sm"
          aria-expanded={expanded} aria-controls={quotesId}
          onClick={() => onToggleExpanded(group.groupKey)}
        >
          {expanded ? <ChevronDown className="mr-1 size-4" aria-hidden="true" /> : <ChevronRight className="mr-1 size-4" aria-hidden="true" />}
          {expanded ? "Ocultar cotações" : `Ver ${quotesLabel(group.quoteCount)}`}
        </Button>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" disabled={disabled || !decidable} onClick={() => onDecide(group, "approved")}>Aceitar item</Button>
          <Button size="sm" variant="ghost" disabled={disabled || !decidable} onClick={() => onDecide(group, "rejected")}>Rejeitar item</Button>
        </div>
      </div>

      {expanded && (
        <div id={quotesId} role="region" aria-label={`Cotações do item ${group.description}`} className="border-t border-border bg-muted/30">
          <ul className="divide-y divide-border">
            {group.quotes.map((q) => (
              <PriceResearchQuoteRow key={q.stagingRowId} quote={q} disabled={disabled} onReviewQuote={onReviewQuote} onOpenQuote={onOpenQuote} />
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
