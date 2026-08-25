import React, { useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

/**
 * TRWorkspace — REAL (wired to tRPC).
 *
 * UX: geração assistida do Termo de Referência a partir dos itens aprovados.
 * Toda saída de IA exige revisão humana — banner de revisão obrigatória.
 */

export type TRWorkspaceProps = {
  processId?: string;
};

export default function TRWorkspace({ processId = "" }: TRWorkspaceProps) {
  const [object, setObject] = useState("");

  const { key: trKey, rotate: rotateTrKey } = useIdempotencyKey();
  const generateTR = trpc.procurementProcess.generateTR.useMutation({ onSuccess: () => rotateTrKey() });
  const draft = generateTR.data?.document;

  const handleGenerate = () => {
    if (!processId || !object.trim()) return;
    generateTR.mutate({ processId, object: object.trim(), idempotencyKey: trKey });
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">
        TR — Termo de Referência
      </h1>
      <p className="text-sm text-muted-foreground">Art. 6º, XXIII da Lei 14.133/2021</p>

      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-foreground">Objeto</span>
          <input
            type="text"
            value={object}
            onChange={(e) => setObject(e.target.value)}
            placeholder="Aquisição de mobiliário corporativo"
            className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!processId || !object.trim() || generateTR.isPending}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {generateTR.isPending ? "Gerando..." : "Gerar rascunho de TR"}
        </button>
        {!processId && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Selecione um processo para gerar o TR.
          </p>
        )}
        {generateTR.isError && (
          <p className="mt-2 text-sm text-destructive">Falha ao gerar o TR.</p>
        )}
      </div>

      {draft && (
        <div className="mt-6">
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Revisão obrigatória.</strong> Rascunho gerado por IA a partir
            dos itens aprovados. Revise e valide antes de utilizar.
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-2 font-semibold text-foreground">{draft.title}</h2>
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">
              {draft.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
