/**
 * PR B.2.2 — Gaveta de detalhe de um item de staging (provenance + confidence + advertências).
 *
 * Exibe a sugestão extraída em detalhe e permite aceitar / rejeitar / pular com nota opcional.
 * Não edita valores (correção diferida à B.2.3). Linguagem institucional.
 */
import { useState, type ReactNode } from "react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ConfidenceBadge, scoreToLevel } from "@/components/ui/ConfidenceBadge";
import { IngestionWarningsPanel } from "./IngestionWarningsPanel";
import {
  extractConfidence, formatProvenance, extractItemWarnings,
  REVIEW_STATUS_LABEL, type StagingItem, type ReviewAction,
} from "@/lib/ingestion/staging";
import { INSTITUTIONAL_COPY } from "@/lib/ingestion/status";

interface StagingReviewDrawerProps {
  item: StagingItem | null;
  open: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onReview: (itemId: number, action: ReviewAction, note?: string) => void;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value ?? "—"}</div>
    </div>
  );
}

export function StagingReviewDrawer({ item, open, disabled, onOpenChange, onReview }: StagingReviewDrawerProps) {
  const [note, setNote] = useState("");
  if (!item) return null;
  const conf = extractConfidence(item.confidenceMetadata);
  const prov = formatProvenance(item.sourceLocation);
  const warnings = extractItemWarnings(item.extractionWarnings).map((message) => ({ message }));
  const isPending = item.reviewStatus === "pending";

  function act(action: ReviewAction) {
    if (!item) return;
    onReview(item.id, action, note.trim() || undefined);
    setNote("");
    onOpenChange(false);
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{INSTITUTIONAL_COPY.extractedContent} · item #{item.id}</DrawerTitle>
          <DrawerDescription>
            Sugestão extraída do arquivo — {INSTITUTIONAL_COPY.reviewNeeded.toLowerCase()}. Estado atual:{" "}
            {REVIEW_STATUS_LABEL[item.reviewStatus]}.
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-2">
          <Field label={INSTITUTIONAL_COPY.extractedContent} value={item.rawDescription} />
          <div className="grid grid-cols-3 gap-3">
            <Field label="Quantidade" value={item.rawQuantity} />
            <Field label="Unidade" value={item.rawUnit} />
            <Field label="Preço unitário" value={item.rawUnitPrice} />
          </div>
          <Field label="Preço total" value={item.rawTotalPrice} />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={INSTITUTIONAL_COPY.extractionConfidence}
              value={conf != null ? <ConfidenceBadge level={scoreToLevel(conf)} score={conf} showScore /> : "—"}
            />
            <Field label={INSTITUTIONAL_COPY.dataOrigin} value={prov} />
          </div>
          {warnings.length > 0 && <IngestionWarningsPanel warnings={warnings} />}

          <div className="space-y-1.5">
            <Label htmlFor={`note-${item.id}`}>Nota da revisão (opcional)</Label>
            <Textarea
              id={`note-${item.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Justificativa ou observação da decisão de revisão…"
              rows={2}
              disabled={disabled || !isPending}
            />
          </div>
        </div>

        <DrawerFooter className="flex-row flex-wrap gap-2">
          <Button variant="outline" disabled={disabled || !isPending} onClick={() => act("approved")}>Aceitar</Button>
          <Button variant="ghost" disabled={disabled || !isPending} onClick={() => act("skipped")}>Pular</Button>
          <Button variant="ghost" className="text-destructive" disabled={disabled || !isPending} onClick={() => act("rejected")}>Rejeitar</Button>
          <DrawerClose asChild>
            <Button variant="secondary" className="ml-auto">Fechar</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
