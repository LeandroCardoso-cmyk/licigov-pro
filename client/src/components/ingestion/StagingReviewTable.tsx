/**
 * PR B.2.2 — Tabela de revisão do staging (sugestões extraídas; revisão humana obrigatória).
 *
 * Cada linha é uma SUGESTÃO extraída (não é documento oficial). Ações: aceitar / rejeitar / pular
 * (idempotentes, auditadas no backend). Correção de VALORES não existe na B.2.1 (diferida à B.2.3),
 * então não há edição inline aqui. Seleção múltipla habilita revisão em lote (só afeta pendentes).
 */
import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { ConfidenceBadge, scoreToLevel } from "@/components/ui/ConfidenceBadge";
import {
  REVIEW_STATUS_LABEL,
  extractConfidence,
  formatProvenance,
  type StagingItem,
  type ReviewAction,
} from "@/lib/ingestion/staging";
import { INSTITUTIONAL_COPY } from "@/lib/ingestion/status";

interface StagingReviewTableProps {
  items: StagingItem[];
  disabled?: boolean;
  onReview: (itemId: number, action: ReviewAction, note?: string) => void;
  onReviewBulk: (itemIds: number[], action: ReviewAction) => void;
  onOpenDetail: (item: StagingItem) => void;
}

export function StagingReviewTable({ items, disabled, onReview, onReviewBulk, onOpenDetail }: StagingReviewTableProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const pendingIds = useMemo(() => items.filter(i => i.reviewStatus === "pending").map(i => i.id), [items]);
  const selectedPending = useMemo(() => Array.from(selected).filter(id => pendingIds.includes(id)), [selected, pendingIds]);
  const allPendingSelected = pendingIds.length > 0 && pendingIds.every(id => selected.has(id));

  function toggle(id: number) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAll() {
    setSelected(allPendingSelected ? new Set() : new Set(pendingIds));
  }
  function bulk(action: ReviewAction) {
    if (selectedPending.length === 0) return;
    onReviewBulk(selectedPending, action);
    setSelected(new Set());
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{INSTITUTIONAL_COPY.humanReviewRequired}</p>

      {selectedPending.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-2"
          role="region"
          aria-label="Ações em lote"
        >
          <span className="text-sm font-medium">{selectedPending.length} selecionado(s):</span>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => bulk("approved")}>Aceitar</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => bulk("skipped")}>Pular</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => bulk("rejected")}>Rejeitar</Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allPendingSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Selecionar todos os pendentes"
                  disabled={disabled || pendingIds.length === 0}
                />
              </TableHead>
              <TableHead>{INSTITUTIONAL_COPY.extractedContent}</TableHead>
              <TableHead className="text-right">Qtd.</TableHead>
              <TableHead>Unid.</TableHead>
              <TableHead className="text-right">Preço unit.</TableHead>
              <TableHead>{INSTITUTIONAL_COPY.extractionConfidence}</TableHead>
              <TableHead>{INSTITUTIONAL_COPY.dataOrigin}</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const conf = extractConfidence(item.confidenceMetadata);
              const prov = formatProvenance(item.sourceLocation);
              const isPending = item.reviewStatus === "pending";
              return (
                <TableRow key={item.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(item.id)}
                      onCheckedChange={() => toggle(item.id)}
                      aria-label={`Selecionar item ${item.id}`}
                      disabled={disabled || !isPending}
                    />
                  </TableCell>
                  <TableCell className="max-w-[22rem] truncate" title={item.rawDescription ?? ""}>
                    {item.rawDescription ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.rawQuantity ?? "—"}</TableCell>
                  <TableCell>{item.rawUnit ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.rawUnitPrice ?? "—"}</TableCell>
                  <TableCell>{conf != null ? <ConfidenceBadge level={scoreToLevel(conf)} score={conf} showScore /> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{prov ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{REVIEW_STATUS_LABEL[item.reviewStatus]}</Badge></TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="outline" disabled={disabled || !isPending} onClick={() => onReview(item.id, "approved")}>Aceitar</Button>
                      <Button size="sm" variant="ghost" disabled={disabled || !isPending} onClick={() => onReview(item.id, "rejected")}>Rejeitar</Button>
                      <Button size="icon" variant="ghost" aria-label={`Detalhes do item ${item.id}`} onClick={() => onOpenDetail(item)}>
                        <Eye className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
