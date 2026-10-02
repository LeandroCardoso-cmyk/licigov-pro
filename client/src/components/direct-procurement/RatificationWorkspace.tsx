import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * RatificationWorkspace — REAL (tRPC).
 *
 * R4 / PR-07 (SEM-004) — registro GOVERNADO da decisão de ratificação:
 *  - NENHUM resultado pré-selecionado: quem registra escolhe explicitamente "Ratificar" ou "Não ratificar";
 *  - a autoridade que DECIDIU (nome, cargo, data e referência do ato) é informada e é distinta de quem REGISTRA
 *    (o usuário logado) — o sistema não presume que quem clicou é a autoridade;
 *  - a decisão corrente, a revisão e o histórico ficam visíveis; registrar de novo cria nova revisão que SUBSTITUI a
 *    anterior (preservada no histórico), com CAS (`expectedRevision`) e chave de idempotência por tentativa;
 *  - a competência jurídica da autoridade não é validada pelo sistema (política pendente) e isso é dito na tela.
 */

export interface RatificationWorkspaceProps {
  workspaceId: string;
  onRatified?: () => void;
}

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `rat-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const OUTCOME_LABEL: Record<string, string> = { ratificado: "Ratificado", nao_ratificado: "Não ratificado" };

export default function RatificationWorkspace({ workspaceId, onRatified }: RatificationWorkspaceProps) {
  const utils = trpc.useUtils();
  const state = trpc.directProcurement.getRatificationDecision.useQuery({ workspaceId });
  const [decision, setDecision] = React.useState<"ratificado" | "nao_ratificado" | null>(null);
  const [decidedByName, setDecidedByName] = React.useState("");
  const [decidedByRole, setDecidedByRole] = React.useState("");
  const [decidedAt, setDecidedAt] = React.useState("");
  const [basisReference, setBasisReference] = React.useState("");
  const [justification, setJustification] = React.useState("");
  const [evidence, setEvidence] = React.useState("");
  const [idempotencyKey, setIdempotencyKey] = React.useState(newKey);

  const ratify = trpc.directProcurement.ratify.useMutation({
    onSuccess: () => {
      setIdempotencyKey(newKey());
      void utils.directProcurement.getRatificationDecision.invalidate({ workspaceId });
      void utils.directProcurement.loadProcess.invalidate({ workspaceId });
      onRatified?.();
    },
  });

  const current = state.data?.current ?? null;
  const currentRevision = state.data?.currentRevision ?? 0;
  const canSubmit = decision !== null && !ratify.isPending && !state.isLoading;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!decision) return;
        ratify.mutate({
          workspaceId, decision, decidedByName, decidedByRole, decidedAt, basisReference, justification,
          evidence: evidence ? evidence.split("\n").filter(Boolean) : undefined,
          expectedRevision: currentRevision, idempotencyKey,
        });
      }}
      className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Ratificação</h3>

      {current ? (
        <div className="rounded-md border border-border bg-muted/40 p-2 text-xs text-foreground">
          <p><strong>Decisão atual (revisão {current.revision}):</strong> {OUTCOME_LABEL[current.outcome] ?? current.outcome}</p>
          <p>Autoridade declarada: {current.decidedByName} — {current.decidedByRole} · Ato de {current.decidedAt} ({current.basisReference})</p>
          <p className="text-muted-foreground">Registrada pelo usuário #{current.recordedByUserId}. Registrar abaixo cria a revisão {current.revision + 1}, que substitui esta (o histórico é preservado).</p>
        </div>
      ) : state.data?.legacyRatification ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          Há um registro antigo ({OUTCOME_LABEL[state.data.legacyRatification.decision] ?? state.data.legacyRatification.decision}) sem autoridade, data e referência do ato. Ele é mantido como histórico e não basta para publicar: registre a decisão com os dados do ato.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Nenhuma decisão registrada.</p>
      )}

      <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs font-medium" role="radiogroup" aria-label="Resultado da decisão">
        <button type="button" role="radio" aria-checked={decision === "ratificado"} onClick={() => setDecision("ratificado")} className={`rounded-md px-3 py-1 transition ${decision === "ratificado" ? "bg-card text-green-700 dark:text-green-300 shadow-sm" : "text-muted-foreground"}`}>Ratificar</button>
        <button type="button" role="radio" aria-checked={decision === "nao_ratificado"} onClick={() => setDecision("nao_ratificado")} className={`rounded-md px-3 py-1 transition ${decision === "nao_ratificado" ? "bg-card text-red-700 dark:text-red-300 shadow-sm" : "text-muted-foreground"}`}>Não ratificar</button>
      </div>
      {decision === null && <p className="text-xs text-muted-foreground">Selecione o resultado decidido pela autoridade — não há resultado padrão.</p>}

      <div className="grid gap-2 sm:grid-cols-2">
        <input value={decidedByName} onChange={(e) => setDecidedByName(e.target.value)} placeholder="Autoridade que decidiu (nome)"
          className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input value={decidedByRole} onChange={(e) => setDecidedByRole(e.target.value)} placeholder="Cargo / função da autoridade"
          className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input type="date" value={decidedAt} onChange={(e) => setDecidedAt(e.target.value)} aria-label="Data do ato"
          className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input value={basisReference} onChange={(e) => setBasisReference(e.target.value)} placeholder="Referência do ato (despacho, portaria, documento)"
          className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </div>
      <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} placeholder="Justificativa da decisão (mín. 10 caracteres)…"
        className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      <textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={2} placeholder="Evidências (uma por linha)…"
        className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      <p className="text-xs text-muted-foreground">
        Você está registrando a decisão tomada pela autoridade informada acima; o registro não torna você a autoridade.
        A competência da autoridade não é validada pelo sistema.
      </p>
      {ratify.isSuccess && <p className="text-xs text-green-700 dark:text-green-300">{ratify.data?.replayed ? "Decisão já registrada (nenhuma alteração)." : "Decisão registrada."}</p>}
      {ratify.isError && <p className="text-xs text-red-600 dark:text-red-400">{ratify.error.message}</p>}
      <button type="submit" disabled={!canSubmit} className="w-full rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
        {ratify.isPending ? "Registrando…" : current ? `Registrar nova decisão (substitui a revisão ${current.revision})` : "Registrar decisão"}
      </button>
    </form>
  );
}
