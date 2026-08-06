/**
 * PR B.2.2 — Gaveta de detalhe/correção de um item de staging.
 *
 * Exibe a sugestão extraída (original imutável) e, para importTypes corrigíveis, permite CORRIGIR
 * campos autorizados (overlay): mostra Original × Atual, exige justificativa, envia com
 * expectedRevision (concorrência otimista) e idempotencyKey. Trata conflito de revisão preservando o
 * rascunho local (sem reaplicar) e sinalizando refetch. A correção NÃO aprova o item nem promove ao
 * domínio; aceitar/rejeitar continua sendo passo explícito. Não expõe JSON bruto ao usuário.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge, scoreToLevel } from "@/components/ui/ConfidenceBadge";
import { IngestionWarningsPanel } from "./IngestionWarningsPanel";
import {
  extractConfidence, formatProvenance, extractItemWarnings,
  REVIEW_STATUS_LABEL, type StagingItem, type ReviewAction,
} from "@/lib/ingestion/staging";
import { INSTITUTIONAL_COPY } from "@/lib/ingestion/status";
import {
  CORRECTABLE_FIELDS, isCorrectable, originalValue, effectiveValue, isCorrected, buildCorrectionPatch,
} from "@/lib/ingestion/correction";
import { newIdempotencyKey } from "@/lib/ingestion/sha256";

interface StagingReviewDrawerProps {
  item: StagingItem | null;
  open: boolean;
  disabled?: boolean;
  importType?: string;
  isCorrecting?: boolean;
  correctError?: { data?: { code?: string } | null; message?: string } | null;
  onOpenChange: (open: boolean) => void;
  onReview: (itemId: number, action: ReviewAction, note?: string) => void;
  onCorrect?: (
    itemId: number, expectedRevision: number, patch: Record<string, string>, justification: string, idempotencyKey: string,
  ) => Promise<unknown> | undefined;
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{value ?? "—"}</div>
    </div>
  );
}

export function StagingReviewDrawer({
  item, open, disabled, importType, isCorrecting, correctError, onOpenChange, onReview, onCorrect,
}: StagingReviewDrawerProps) {
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [justification, setJustification] = useState("");

  const fields = useMemo(() => (importType && isCorrectable(importType) ? CORRECTABLE_FIELDS[importType] : []), [importType]);
  const canCorrect = fields.length > 0 && !!onCorrect;
  const isConflict = correctError?.data?.code === "CONFLICT";

  // Sincroniza o rascunho com o valor EFETIVO atual quando o item muda — mas em conflito preserva o
  // rascunho local (não reaplica automaticamente a edição).
  useEffect(() => {
    if (!item || isConflict) return;
    const next: Record<string, string> = {};
    for (const f of fields) next[f.logical] = effectiveValue(item, f) ?? "";
    setDraft(next);
  }, [item, fields, isConflict]);

  if (!item) return null;

  const conf = extractConfidence(item.confidenceMetadata);
  const prov = formatProvenance(item.sourceLocation);
  const warnings = extractItemWarnings(item.extractionWarnings).map((message) => ({ message }));
  const isPending = item.reviewStatus === "pending";
  const revision = item.correctionRevision ?? 0;
  const patch = buildCorrectionPatch(item, fields, draft);
  const hasChanges = Object.keys(patch).length > 0;

  function act(action: ReviewAction) {
    if (!item) return;
    onReview(item.id, action, note.trim() || undefined);
    setNote("");
    onOpenChange(false);
  }

  async function saveCorrection() {
    if (!item || !onCorrect || !hasChanges || justification.trim().length === 0) return;
    await onCorrect(item.id, revision, patch, justification.trim(), newIdempotencyKey());
    setJustification("");
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            {INSTITUTIONAL_COPY.extractedContent} · item #{item.id}
            {isCorrected(item) && (
              <Badge className="border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
                Conteúdo corrigido · rev. {revision}
              </Badge>
            )}
          </DrawerTitle>
          <DrawerDescription>
            Sugestão extraída do arquivo — {INSTITUTIONAL_COPY.reviewNeeded.toLowerCase()}. Estado: {REVIEW_STATUS_LABEL[item.reviewStatus]}.
            {isCorrected(item) && item.correctedByUserId != null && (
              <> · Última correção por #{item.correctedByUserId}
                {item.correctedAt ? ` em ${new Date(item.correctedAt).toLocaleString("pt-BR")}` : ""}.</>
            )}
          </DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 overflow-y-auto px-4 pb-2">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={INSTITUTIONAL_COPY.extractionConfidence}
              value={conf != null ? <ConfidenceBadge level={scoreToLevel(conf)} score={conf} showScore /> : "—"}
            />
            <Field label={INSTITUTIONAL_COPY.dataOrigin} value={prov} />
          </div>
          {warnings.length > 0 && <IngestionWarningsPanel warnings={warnings} />}

          {/* Correção de campos autorizados (Original × Atual) */}
          {canCorrect ? (
            <div className="space-y-3 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-foreground">Corrigir campos</p>
              {fields.map((f) => {
                const original = originalValue(item, f) ?? "";
                return (
                  <div key={f.logical} className="space-y-1">
                    <Label htmlFor={`corr-${item.id}-${f.logical}`}>{f.label}</Label>
                    <Input
                      id={`corr-${item.id}-${f.logical}`}
                      value={draft[f.logical] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [f.logical]: e.target.value }))}
                      disabled={disabled || isCorrecting}
                      aria-describedby={`orig-${item.id}-${f.logical}`}
                    />
                    <p id={`orig-${item.id}-${f.logical}`} className="text-xs text-muted-foreground">
                      Original: <span className="font-mono">{original || "—"}</span>
                    </p>
                  </div>
                );
              })}
              <div className="space-y-1">
                <Label htmlFor={`corr-just-${item.id}`}>Justificativa da correção (obrigatória)</Label>
                <Textarea
                  id={`corr-just-${item.id}`}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  rows={2}
                  disabled={disabled || isCorrecting}
                  placeholder="Explique a correção (ex.: valor unitário digitado errado na planilha)…"
                />
              </div>
              {isConflict && (
                <p className="text-sm text-destructive" role="alert">
                  Este item foi alterado por outro revisor. Atualize os dados antes de continuar.
                </p>
              )}
              {correctError && !isConflict && (
                <p className="text-sm text-destructive">{correctError.message}</p>
              )}
              <Button
                size="sm"
                onClick={saveCorrection}
                disabled={disabled || isCorrecting || !hasChanges || justification.trim().length === 0}
              >
                {isCorrecting ? "Salvando correção…" : "Salvar correção"}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Quantidade" value={item.rawQuantity} />
              <Field label="Unidade" value={item.rawUnit} />
              <Field label="Preço unitário" value={item.rawUnitPrice} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`note-${item.id}`}>Nota da revisão (opcional)</Label>
            <Textarea
              id={`note-${item.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Observação da decisão de revisão…"
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
