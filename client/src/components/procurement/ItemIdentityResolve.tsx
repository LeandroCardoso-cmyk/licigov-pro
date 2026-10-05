import React from "react";
import { trpc } from "../../lib/trpc";
import { domainErrorMessage } from "@/lib/domainErrorMessage";
import {
  IDENTITY_EFFECT_NOTE, identityResolutionBlocker, resolveIdentityInput,
  type IdentityChoice,
} from "./itemIdentityView";

/**
 * R9 / SEM-054 — tela de resolução humana de "Identidade a revisar": vincular a um item existente do processo ou
 * declarar item novo, com motivo obrigatório. Nada vem pré-selecionado; "Cancelar" não chama o servidor.
 */
export type ItemIdentityResolveProps = {
  processId: string;
  item: { id: string; description?: string | null; sourceStateReason?: string | null };
  /** Demais itens do processo (alvos possíveis do vínculo). */
  candidates: ReadonlyArray<{ id: string; description?: string | null }>;
  onClose: () => void;
  onResolved?: () => void;
};

export default function ItemIdentityResolve({ processId, item, candidates, onClose, onResolved }: ItemIdentityResolveProps) {
  const [choice, setChoice] = React.useState<IdentityChoice | null>(null);
  const [targetItemId, setTargetItemId] = React.useState<string | null>(null);
  const [reason, setReason] = React.useState("");
  const resolve = trpc.procurementProcess.resolveItemIdentity.useMutation({
    onSuccess: () => { onResolved?.(); onClose(); },
  });
  const draft = { choice, targetItemId, reason };
  const blocker = identityResolutionBlocker(draft);
  const input = resolveIdentityInput(processId, item, draft);
  const others = candidates.filter((c) => c.id !== item.id);

  return (
    <section role="region" aria-label="Resolver identidade do item" className="rounded-lg border border-amber-400 bg-amber-50 p-4 text-sm text-foreground dark:border-amber-700 dark:bg-amber-950">
      <p className="font-medium">Resolver identidade — {item.description?.trim() || "[item sem descrição]"}</p>
      <p className="mt-1 text-xs text-muted-foreground">{IDENTITY_EFFECT_NOTE}</p>
      <fieldset className="mt-3 space-y-2">
        <legend className="text-xs font-medium">Como resolver?</legend>
        <label className="flex items-center gap-2 text-xs">
          <input type="radio" name={`identity-${item.id}`} checked={choice === "link_existing"} onChange={() => setChoice("link_existing")} />
          Vincular a um item existente deste processo
        </label>
        {choice === "link_existing" && (
          <select
            aria-label="Item existente"
            value={targetItemId ?? ""}
            onChange={(e) => setTargetItemId(e.target.value || null)}
            className="ml-6 w-[calc(100%-1.5rem)] rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            <option value="">Selecione o item…</option>
            {others.map((c) => <option key={c.id} value={c.id}>{c.description?.trim() || "[item sem descrição]"}</option>)}
          </select>
        )}
        <label className="flex items-center gap-2 text-xs">
          <input type="radio" name={`identity-${item.id}`} checked={choice === "new_item"} onChange={() => { setChoice("new_item"); setTargetItemId(null); }} />
          Declarar item novo
        </label>
      </fieldset>
      <label className="mt-3 block text-xs font-medium">
        Motivo (obrigatório, fica na trilha de auditoria)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={255}
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
        />
      </label>
      {resolve.isError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {domainErrorMessage(resolve.error.message, "Não foi possível registrar a resolução de identidade.")}
        </p>
      )}
      {blocker && <p className="mt-2 text-xs text-muted-foreground">{blocker}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={resolve.isPending} className="rounded-md border border-input px-3 py-1 text-xs">Cancelar</button>
        <button
          type="button"
          onClick={() => { if (input) resolve.mutate(input); }}
          disabled={!input || resolve.isPending}
          className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          Confirmar resolução
        </button>
      </div>
    </section>
  );
}
