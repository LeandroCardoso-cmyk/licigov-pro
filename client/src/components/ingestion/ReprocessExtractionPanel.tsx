/**
 * Layout v2 — "Reprocessar extração" (ação GOVERNADA). Aparece SOMENTE quando o servidor informa que a sessão é
 * elegível (nenhum item aceito/rejeitado/pulado/corrigido, nenhuma promoção). Exige confirmação explícita e
 * motivo (auditado). Explica o efeito antes da confirmação. Acessível e compatível com dark mode.
 */
import React, { useState } from "react";
import { RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { describeReprocess, isValidReprocessReason, REPROCESS_NOTICE, type ReprocessStatusLike } from "@/lib/ingestion/reprocess";

interface ReprocessExtractionPanelProps {
  reprocess: ReprocessStatusLike | null | undefined;
  isReprocessing: boolean;
  error: string | null;
  onReprocess: (reason: string) => void;
}

export function ReprocessExtractionPanel({ reprocess, isReprocessing, error, onReprocess }: ReprocessExtractionPanelProps) {
  const view = describeReprocess(reprocess);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");

  if (view.inProgress) {
    return (
      <Alert>
        <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
        <AlertTitle>Reprocessando a extração</AlertTitle>
        <AlertDescription>
          A leitura do arquivo original está sendo refeita. Aguarde antes de revisar: se algum item for revisado
          agora, o reprocessamento é cancelado e nada é substituído.
        </AlertDescription>
      </Alert>
    );
  }
  if (!view.showAction) return null;

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      {!confirming ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Nenhum item foi revisado ainda. Se a leitura da tabela ficou incorreta, é possível refazer a extração.
          </p>
          <Button variant="outline" size="sm" onClick={() => setConfirming(true)} disabled={isReprocessing}>
            <RefreshCw className="mr-1 size-4" aria-hidden="true" /> Reprocessar extração
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <Alert>
            <Info className="size-4" aria-hidden="true" />
            <AlertTitle>Confirmar reprocessamento</AlertTitle>
            <AlertDescription>{REPROCESS_NOTICE}</AlertDescription>
          </Alert>
          <label className="text-sm font-medium" htmlFor="reprocess-reason">Motivo (registrado na auditoria)</label>
          <Textarea
            id="reprocess-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="Ex.: a tabela do mapa de apuração foi lida de forma incorreta."
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={isReprocessing || !isValidReprocessReason(reason)}
              onClick={() => onReprocess(reason.trim())}
            >
              {isReprocessing ? "Solicitando…" : "Confirmar reprocessamento"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setConfirming(false); setReason(""); }} disabled={isReprocessing}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
