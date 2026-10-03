import React from "react";
import { trpc } from "../../lib/trpc";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import {
  applyInputFromPreview, isStaleConfirmationError, sourceUpdateConfirmModel,
} from "./itemSourceUpdateView";

/**
 * R9 / SEM-052 — CONFIRMAÇÃO explícita de "Aplicar cotações atualizadas".
 *
 * Antes: um clique trocava cotações/média e revogava a aprovação, com o comparativo só num tooltip.
 * Agora: a prévia do SERVIDOR mostra, para o item, atual × proposto (cotações válidas, preço médio em
 * centavos, cotações incluídas/removidas/alteradas) e declara a revogação da decisão humana; a confirmação
 * envia o `expectedStateToken` dessa prévia. Se o estado mudou (outra importação, outra decisão), o servidor
 * responde CONFLICT, nada é aplicado e a comparação é recarregada para nova revisão.
 */
export type ItemSourceUpdateConfirmProps = {
  itemId: string;
  onClose: () => void;
  onApplied?: () => void;
};

export default function ItemSourceUpdateConfirm({ itemId, onClose, onApplied }: ItemSourceUpdateConfirmProps) {
  const preview = trpc.procurementProcess.previewItemSourceUpdate.useQuery(
    { itemId },
    // Reabrir a confirmação SEMPRE recarrega a prévia (confirmar fica desabilitado enquanto carrega); fora disso,
    // nada de refetch silencioso em segundo plano — a comparação exibida é a que será confirmada.
    { enabled: !!itemId, refetchOnMount: "always", refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false },
  );
  const apply = trpc.procurementProcess.applyItemSourceUpdate.useMutation({
    onSuccess: () => {
      onApplied?.();
      onClose();
    },
    onError: (err) => {
      // Confirmação desatualizada: nada foi aplicado; recarrega a comparação para nova revisão.
      if (isStaleConfirmationError(err)) void preview.refetch();
    },
  });
  // O erro da mutação persiste até a próxima confirmação (mutate o reinicia).
  const staleNotice = isStaleConfirmationError(apply.error);

  const data = preview.data;
  const model = data ? sourceUpdateConfirmModel(data) : null;
  // Prévia recarregando ou com erro (ex.: atualização já não pendente) ⇒ não há o que confirmar.
  const busy = apply.isPending || preview.isFetching || preview.isError;

  return (
    <section
      role="region"
      aria-label="Confirmar aplicação das cotações atualizadas"
      className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-foreground dark:border-amber-700 dark:bg-amber-950"
    >
      {preview.isLoading ? (
        <p className="text-muted-foreground">Carregando a comparação das cotações…</p>
      ) : preview.isError && !data ? (
        <p role="alert" className="text-destructive">
          {domainErrorMessage(preview.error?.message, "Não foi possível carregar a comparação das cotações.")}
        </p>
      ) : model && data ? (
        <>
          <h3 className="mb-2 font-semibold">{model.title}</h3>
          {staleNotice && (
            <p role="alert" className="mb-3 rounded-md border border-amber-500 px-3 py-2 text-amber-800 dark:text-amber-200">
              As cotações ou a decisão deste item mudaram depois da comparação anterior. Nada foi aplicado —
              revise a comparação atualizada abaixo antes de confirmar.
            </p>
          )}
          <table className="mb-3 w-full text-left text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2 font-medium" scope="col">&nbsp;</th>
                <th className="py-1 pr-2 font-medium" scope="col">Atual</th>
                <th className="py-1 font-medium" scope="col">Após aplicar</th>
              </tr>
            </thead>
            <tbody>
              {model.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="py-1 pr-2 font-medium">{r.label}</th>
                  <td className="py-1 pr-2 font-mono">{r.before}</td>
                  <td className="py-1 font-mono">{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mb-2 text-xs text-muted-foreground">Variação do preço médio: <span className="font-mono">{model.averageDelta}</span></p>
          {([
            ["Cotações incluídas", model.added],
            ["Cotações removidas", model.removed],
            ["Cotações alteradas", model.changed],
          ] as const).map(([label, list]) => list.length > 0 && (
            <div key={label} className="mb-2 text-xs">
              <p className="font-medium">{label}</p>
              <ul className="list-disc pl-4">
                {list.map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          ))}
          <p
            className={`mb-3 rounded-md px-3 py-2 text-xs font-medium ${model.revokes ? "border border-red-300 text-red-700 dark:border-red-800 dark:text-red-300" : "text-muted-foreground"}`}
          >
            {model.decisionNotice}
          </p>
          {preview.isError && (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {domainErrorMessage(preview.error?.message, "Não foi possível recarregar a comparação das cotações.")}
            </p>
          )}
          {apply.error && !isStaleConfirmationError(apply.error) && (
            <p role="alert" className="mb-2 text-xs text-destructive">
              {domainErrorMessage(apply.error.message, "Não foi possível aplicar as cotações atualizadas.")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={apply.isPending}
              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => apply.mutate(applyInputFromPreview(data))}
              disabled={busy}
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-amber-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
            >
              {apply.isPending ? "Aplicando..." : model.revokes ? "Confirmar: aplicar e revogar a decisão" : "Confirmar e aplicar"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
