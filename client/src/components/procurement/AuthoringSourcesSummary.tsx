/**
 * P0 piloto — Resumo das FONTES do processo antes de gerar o ETP/TR ("Gerar TR com base no processo").
 *
 * Mostra o que a autoria vai usar (DFD/ETP — inclusive importados —, Itens Inteligentes aprovados,
 * cotações, classificação confirmada, valor estimado global calculado pelo SISTEMA) e o estado do rascunho
 * frente às fontes atuais (atual / fontes mudaram / importado). Read-only; nenhum pré-requisito artificial:
 * fonte ausente é pendência sinalizada, não bloqueio.
 */
import { CheckCircle2, CircleDashed, AlertTriangle } from "lucide-react";
import { trpc } from "../../lib/trpc";
import { formatCentsBRL } from "@/lib/money";

export type AuthoringSourcesSummaryProps = { processId: string; kind: "etp" | "tr"; object: string };

function Row({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" aria-hidden="true" />
        : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <span className="text-foreground">{label}{detail ? <span className="text-muted-foreground"> — {detail}</span> : null}</span>
    </li>
  );
}

export default function AuthoringSourcesSummary({ processId, kind, object }: AuthoringSourcesSummaryProps) {
  const q = trpc.procurementProcess.authoringSourceState.useQuery(
    { processId, kind, object },
    { enabled: !!processId && object.trim().length > 0, refetchOnWindowFocus: false },
  );
  if (!q.data) return null;
  const { summary: s, state } = q.data;
  const originLabel = (o: string | null) => (o === "import" ? "importado e revisado" : o === "manual" ? "editado manualmente" : o ? "gerado" : undefined);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-sm font-medium text-foreground">Fontes do processo usadas na geração</p>
      <ul className="space-y-1">
        <Row ok={s.dfd.present} label="DFD" detail={s.dfd.present ? originLabel(s.dfd.origin) : "ausente — será sinalizado para revisão"} />
        {kind === "tr" && (
          <Row ok={s.etp.present} label="ETP" detail={s.etp.present ? originLabel(s.etp.origin) : "ausente — será sinalizado para revisão"} />
        )}
        <Row
          ok={s.approvedItems > 0}
          label={`${s.approvedItems} Item(ns) Inteligente(s) aprovado(s)`}
          detail={s.pendingItems > 0 ? `${s.pendingItems} ainda pendente(s) de aprovação (não entram)` : undefined}
        />
        <Row ok={s.quoteCount > 0} label={`Baseado em ${s.quoteCount} cotação(ões) válida(s)`} />
        {s.approvedItems > 0 && (
          <Row
            ok={s.pendingClassifications === 0}
            label={`Classificação CATMAT/CATSER: ${s.confirmedClassifications} confirmada(s)`}
            detail={s.pendingClassifications > 0 ? `${s.pendingClassifications} a revisar (sugestão não é decisão)` : undefined}
          />
        )}
        {kind === "tr" && s.approvedItems > 0 && (
          <Row
            ok={s.unpricedItems === 0}
            label={`Valor estimado global (calculado pelo sistema): ${formatCentsBRL(s.estimatedGlobalTotalCents)}`}
            detail={s.unpricedItems > 0 ? `${s.unpricedItems} item(ns) sem preço de referência` : undefined}
          />
        )}
      </ul>
      {kind === "tr" && (
        <p className="mt-2 text-xs text-muted-foreground">
          Quantidades, preços e totais entram no TR por um quadro gerado pelo sistema — não são redigidos pela IA.
        </p>
      )}
      {state === "source_changed" && (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          As fontes do processo mudaram desde a última geração deste {kind.toUpperCase()}. Gere novamente para refletir os dados atuais.
        </p>
      )}
      {state === "imported" && (
        <p className="mt-3 text-xs text-muted-foreground">
          O rascunho atual foi importado. Gerar com base no processo cria uma nova versão do rascunho (a importada fica no histórico).
        </p>
      )}
    </div>
  );
}
