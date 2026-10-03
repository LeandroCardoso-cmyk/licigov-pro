/**
 * PR B.2.4 — Promoção supervisionada do conteúdo revisado ao domínio (Pesquisa de Preços).
 *
 * Mostra a ação SOMENTE quando elegível; exige confirmação humana explícita; explica destino e efeito;
 * reflete o estado PERSISTIDO (após reload) via `status`; mostra sucesso/conflito/erro acionável; impede
 * duplo clique. Sem progresso fictício. Acessível e compatível com dark mode. Linguagem institucional.
 *
 * R9 / SEM-053 — antes de confirmar, mostra o IMPACTO calculado pelo servidor (`ingestion.previewPromotion`):
 * Itens Inteligentes novos, existentes mesclados/recalculados (nº de cotações e média antes × depois), decididos
 * marcados "Fonte alterada" e itens marcados "Identidade a revisar". "Confirmar promoção" só habilita com a prévia
 * carregada E o reconhecimento explícito do impacto.
 */
import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  promotionConflictMessage, promotionImpactLines, promotionAffectsExisting,
  type PromotionPreviewView, type PromotionPreviewItemView,
} from "@/lib/ingestion/promotion";
import { formatCentsBRL } from "@/lib/money";

/** Estilo desabilitado institucional (sem opacity-50 do shadcn). */
const DISABLED_BUTTON = "disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100";

interface PromoteResult {
  idempotent?: boolean;
  itemsPromoted?: number;
  targetRef?: string;
  /** P0 piloto — projeção canônica em Itens Inteligentes feita na MESMA transação da promoção. */
  intelligentItems?: {
    created: number; updated: number; unchanged: number; preserved: number; total: number;
    /** R9 / SEM-053 — decididos marcados "Fonte alterada" e identidades a revisar (efeito real informado). */
    sourceChanged?: number; reviewRequired?: number;
  };
}

interface PromoteToDomainPanelProps {
  /** Estado de promoção persistido no servidor ("none" | "promoted"). */
  status: string;
  /** Tipo de importação da sessão (só price_research é promovível nesta versão). */
  importType: string;
  /** Elegibilidade calculada (sessão aprovada, sem pendências, tipo promovível, ainda não promovida). */
  canPromote: boolean;
  /** Sessão elegível, mas o papel do usuário não permite a promoção. */
  requiresManager?: boolean;
  isPromoting: boolean;
  error: string | null;
  result: PromoteResult | null;
  onPromote: () => void;
  /** CTA pós-promoção: abrir a aba de Itens Inteligentes para revisão/aprovação. */
  onReviewItems?: () => void;
  /** R9 / SEM-053 — prévia do impacto calculada pelo servidor (null enquanto não carregada). */
  preview?: PromotionPreviewView | null;
  isPreviewLoading?: boolean;
  previewError?: string | null;
  /** Solicita (ou recalcula) a prévia ao abrir a confirmação. */
  onRequestPreview?: () => void;
}

function ImpactItemList({ title, items, total, limit }: { title: string; items: PromotionPreviewItemView[]; total: number; limit: number }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium">{title}</p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
        {items.map((i) => (
          <li key={i.itemId}>
            <span className="font-medium">{i.description || "(sem descrição)"}</span>
            {": "}{i.beforeQuoteCount} → {i.afterQuoteCount} cotação(ões); média {formatCentsBRL(i.beforeAverageCents)} → {formatCentsBRL(i.afterAverageCents)}
          </li>
        ))}
      </ul>
      {total > items.length && (
        <p className="text-xs text-muted-foreground">Exibindo {Math.min(items.length, limit)} de {total}.</p>
      )}
    </div>
  );
}

export interface PromotionImpactConfirmationProps {
  preview: PromotionPreviewView | null;
  isPreviewLoading: boolean;
  previewError: string | null;
  isPromoting: boolean;
  acknowledged: boolean;
  onAcknowledgedChange: (v: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * R9 / SEM-053 — Confirmação com o impacto da promoção. Sem prévia (carregando/erro) ⇒ não há confirmação;
 * com prévia ⇒ confirmação exige reconhecimento explícito do impacto.
 */
export function PromotionImpactConfirmation({
  preview, isPreviewLoading, previewError, isPromoting, acknowledged, onAcknowledgedChange, onConfirm, onCancel,
}: PromotionImpactConfirmationProps) {
  const canConfirm = !!preview && acknowledged && !isPromoting && !isPreviewLoading;
  const affectsExisting = preview ? promotionAffectsExisting(preview) : false;
  return (
    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <p className="text-sm font-medium">Confirmar promoção ao domínio</p>
      <p className="text-xs">
        Isto criará a Pesquisa de Preços deste processo a partir dos itens <strong>aprovados</strong>
        {" "}(conteúdo revisado: valores originais com as correções aplicadas) e atualizará os <strong>Itens
        Inteligentes</strong> do processo. Não altera o staging nem o histórico, e <strong>não</strong> torna o
        documento juridicamente aprovado. A ação é idempotente.
      </p>

      <div aria-live="polite" className="space-y-2">
        {isPreviewLoading && <p className="text-xs">Calculando o impacto nos Itens Inteligentes…</p>}
        {previewError && !isPreviewLoading && (
          <p className="text-xs text-destructive" role="alert">
            Não foi possível calcular o impacto da promoção: {previewError}
          </p>
        )}
        {preview && !isPreviewLoading && (
          <div className="space-y-2" data-testid="promotion-impact">
            <p className="text-xs font-medium">O que acontecerá com os Itens Inteligentes:</p>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {promotionImpactLines(preview).map((l) => (
                <li key={l.key} data-impact={l.key} className={l.affectsExisting ? "font-medium" : undefined}>{l.text}</li>
              ))}
            </ul>
            <ImpactItemList title="Mesclados e recalculados" items={preview.merges} total={preview.intelligentItems.merge} limit={preview.detailLimit} />
            <ImpactItemList title="Marcados como Fonte alterada (proposta pendente de revisão)" items={preview.sourceChanges} total={preview.intelligentItems.sourceChanged} limit={preview.detailLimit} />
            <div className="flex items-start gap-2 pt-1">
              <Checkbox
                id="promotion-impact-ack"
                checked={acknowledged}
                onCheckedChange={(v) => onAcknowledgedChange(v === true)}
                disabled={isPromoting}
                className="mt-0.5 disabled:opacity-100 disabled:bg-muted"
              />
              <Label htmlFor="promotion-impact-ack" className="text-xs font-normal leading-snug">
                {affectsExisting
                  ? "Li o impacto acima e confirmo que Itens Inteligentes existentes serão alterados/marcados por esta promoção."
                  : "Li o impacto acima e confirmo a promoção."}
              </Label>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          className={DISABLED_BUTTON}
          onClick={onConfirm}
          disabled={!canConfirm}
          aria-busy={isPromoting}
        >
          {isPromoting ? "Promovendo…" : "Confirmar promoção"}
        </Button>
        <Button size="sm" variant="ghost" className={DISABLED_BUTTON} onClick={onCancel} disabled={isPromoting}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function PromoteToDomainPanel({
  status, importType, canPromote, requiresManager = false, isPromoting, error, result, onPromote, onReviewItems,
  preview = null, isPreviewLoading = false, previewError = null, onRequestPreview,
}: PromoteToDomainPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  // Estado PERSISTIDO: já promovida (reflete após reload, pois `status` vem do servidor).
  if (status === "promoted" || result?.idempotent) {
    return (
      <Alert className="border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
        <AlertTitle>Conteúdo promovido à Pesquisa de Preços</AlertTitle>
        <AlertDescription>
          {typeof result?.itemsPromoted === "number"
            ? <>{result.itemsPromoted} {result.itemsPromoted === 1 ? "cotação promovida" : "cotações promovidas"}</>
            : "As cotações revisadas foram promovidas"}
          {result?.intelligentItems
            ? <> → {result.intelligentItems.total} Item(ns) Inteligente(s) ({result.intelligentItems.created} novo(s){result.intelligentItems.updated ? `, ${result.intelligentItems.updated} atualizado(s)` : ""}{result.intelligentItems.preserved ? `, ${result.intelligentItems.preserved} já decidido(s) preservado(s)` : ""}{result.intelligentItems.sourceChanged ? `, ${result.intelligentItems.sourceChanged} marcado(s) como Fonte alterada` : ""}{result.intelligentItems.reviewRequired ? `, ${result.intelligentItems.reviewRequired} identidade(s) a revisar` : ""}).</>
            : "."}
          {" "}Cotações do mesmo item (mesma descrição, unidade e quantidade) foram consolidadas; a média é calculada pelo sistema.
          A promoção é definitiva e idempotente — não recria itens ao repetir.
          {onReviewItems && (
            <div className="mt-2">
              <Button size="sm" className={DISABLED_BUTTON} onClick={onReviewItems}>Revisar Itens Inteligentes</Button>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  // Capacidade indisponível para o tipo (DFD/ETP/TR/CATMAT não são contêineres de linhas).
  if (importType !== "price_research") {
    return (
      <p className="text-xs text-muted-foreground">
        A promoção ao domínio está disponível apenas para Pesquisa de Preços nesta versão. Para este tipo
        de documento, os itens permanecem em revisão e não são promovidos automaticamente.
      </p>
    );
  }

  if (requiresManager) {
    return (
      <p className="text-sm text-muted-foreground">
        A revisão está aprovada. A promoção das cotações à Pesquisa de Preços exige perfil Gestor ou superior na organização.
      </p>
    );
  }

  if (!canPromote) return null; // não elegível (ex.: ainda há pendências) — sem ação

  return (
    <div className="space-y-2" role="group" aria-label="Promover conteúdo revisado">
      {!confirming ? (
        <Button
          variant="secondary"
          className={DISABLED_BUTTON}
          onClick={() => { setAcknowledged(false); setConfirming(true); onRequestPreview?.(); }}
          disabled={isPromoting}
        >
          Promover conteúdo revisado…
        </Button>
      ) : (
        <PromotionImpactConfirmation
          preview={preview}
          isPreviewLoading={isPreviewLoading}
          previewError={previewError}
          isPromoting={isPromoting}
          acknowledged={acknowledged}
          onAcknowledgedChange={setAcknowledged}
          onConfirm={() => { setConfirming(false); setAcknowledged(false); onPromote(); }}
          onCancel={() => { setConfirming(false); setAcknowledged(false); }}
        />
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {promotionConflictMessage(error)}
        </p>
      )}
    </div>
  );
}
