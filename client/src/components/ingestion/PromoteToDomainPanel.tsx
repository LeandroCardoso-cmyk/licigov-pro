/**
 * PR B.2.4 — Promoção supervisionada do conteúdo revisado ao domínio (Pesquisa de Preços).
 *
 * Mostra a ação SOMENTE quando elegível; exige confirmação humana explícita; explica destino e efeito;
 * reflete o estado PERSISTIDO (após reload) via `status`; mostra sucesso/conflito/erro acionável; impede
 * duplo clique. Sem progresso fictício. Acessível e compatível com dark mode. Linguagem institucional.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { promotionConflictMessage } from "@/lib/ingestion/promotion";

interface PromoteResult {
  idempotent?: boolean;
  itemsPromoted?: number;
  targetRef?: string;
}

interface PromoteToDomainPanelProps {
  /** Estado de promoção persistido no servidor ("none" | "promoted"). */
  status: string;
  /** Tipo de importação da sessão (só price_research é promovível nesta versão). */
  importType: string;
  /** Elegibilidade calculada (sessão aprovada, sem pendências, tipo promovível, ainda não promovida). */
  canPromote: boolean;
  isPromoting: boolean;
  error: string | null;
  result: PromoteResult | null;
  onPromote: () => void;
}

export function PromoteToDomainPanel({
  status, importType, canPromote, isPromoting, error, result, onPromote,
}: PromoteToDomainPanelProps) {
  const [confirming, setConfirming] = useState(false);

  // Estado PERSISTIDO: já promovida (reflete após reload, pois `status` vem do servidor).
  if (status === "promoted" || result?.idempotent) {
    return (
      <Alert className="border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
        <AlertTitle>Conteúdo promovido à Pesquisa de Preços</AlertTitle>
        <AlertDescription>
          Os itens revisados foram promovidos ao domínio de Pesquisa de Preços deste processo
          {typeof result?.itemsPromoted === "number" ? ` (${result.itemsPromoted} ${result.itemsPromoted === 1 ? "item" : "itens"})` : ""}.
          A promoção é definitiva e idempotente — não recria itens ao repetir.
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

  if (!canPromote) return null; // não elegível (ex.: ainda há pendências) — sem ação

  return (
    <div className="space-y-2" role="group" aria-label="Promover conteúdo revisado">
      {!confirming ? (
        <Button variant="secondary" onClick={() => setConfirming(true)} disabled={isPromoting}>
          Promover conteúdo revisado
        </Button>
      ) : (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <p className="text-sm font-medium">Confirmar promoção ao domínio</p>
          <p className="text-xs">
            Isto criará a Pesquisa de Preços deste processo a partir dos itens <strong>aprovados</strong>
            {" "}(conteúdo revisado: valores originais com as correções aplicadas). Não altera o staging nem
            o histórico, e <strong>não</strong> torna o documento juridicamente aprovado. A ação é idempotente.
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => { setConfirming(false); onPromote(); }}
              disabled={isPromoting}
              aria-busy={isPromoting}
            >
              {isPromoting ? "Promovendo…" : "Confirmar promoção"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={isPromoting}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {promotionConflictMessage(error)}
        </p>
      )}
    </div>
  );
}
