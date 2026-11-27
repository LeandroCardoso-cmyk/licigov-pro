import React from "react";
import { trpc } from "../../lib/trpc";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import { ADDENDUM_TYPE_LABELS } from "./labels";

/**
 * AddendumWorkspace — REAL (tRPC).
 *
 * Termos aditivos (prazo/valor/quantitativo/qualitativo). Fluxo: solicitar → justificar → minuta (termo gerado) →
 * parecer jurídico (quando exigido: valor/quantitativo) → FORMALIZAÇÃO (registro do termo assinado). PROMPT 08 / D-2:
 * criar/editar/exportar a minuta NÃO altera o contrato; vigência, valores e alertas só mudam na formalização.
 */

export interface AddendumWorkspaceProps {
  contractId: string;
  addenda?: Array<{ id: string; addendumType: string; sequence: number; justification: string; newValue: number; newTerm: string; status: string; requestOrigin?: string; documentReference?: string }>;
  /** Vigência acompanhada hoje (derivada do Centro de Operações); mostrada para a pessoa saber o que o aditivo de prazo vai mover. */
  currentEndDate?: string | null;
}

const TYPES: Array<"prazo" | "valor" | "quantitativo" | "qualitativo"> = ["prazo", "valor", "quantitativo", "qualitativo"];
type Origin = "contract_workspace" | "institutional_request" | "documento_externo" | "solicitacao_manual";
const ORIGINS: Array<{ value: Origin; label: string }> = [
  { value: "contract_workspace", label: "Contract Workspace" },
  { value: "institutional_request", label: "Institutional Request" },
  { value: "documento_externo", label: "Documento Externo" },
  { value: "solicitacao_manual", label: "Solicitação Manual" },
];
const ORIGIN_LABELS: Record<string, string> = Object.fromEntries(ORIGINS.map((o) => [o.value, o.label]));

const ADDENDUM_STATUS_LABELS: Record<string, string> = {
  solicitado: "Solicitado", justificado: "Justificado", minuta: "Minuta (sem efeito)",
  aguardando_parecer: "Aguardando parecer (sem efeito)", finalizado: "Formalizado",
};

/**
 * PROMPT 08 / D-2 — registro da formalização: data de assinatura + referência do termo assinado (+ parecer, quando exigido).
 * O texto do botão corresponde exatamente à ação; o sistema não assina nem presume assinatura.
 */
function FormalizeAddendumForm({ contractId, addendum }: { contractId: string; addendum: { id: string; addendumType: string; sequence: number } }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = React.useState(false);
  const [signedOn, setSignedOn] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [opinionId, setOpinionId] = React.useState("");
  const { key, rotate } = useIdempotencyKey();
  const needsOpinion = addendum.addendumType === "valor" || addendum.addendumType === "quantitativo";
  const formalize = trpc.contractWorkspace.formalizeAddendum.useMutation({
    onSuccess: () => { rotate(); setOpen(false); void utils.contractWorkspace.loadContract.invalidate({ contractId }); },
  });
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-[11px] font-medium text-indigo-700 underline dark:text-indigo-300">Registrar formalização</button>;
  }
  return (
    <form
      className="w-72 space-y-1 rounded-md border border-border p-2 text-left"
      data-testid="addendum-formalize-form"
      onSubmit={(e) => {
        e.preventDefault();
        formalize.mutate({ contractId, addendumId: addendum.id, signedOn, formalizationReference: reference, legalOpinionRequestId: opinionId.trim() || undefined, idempotencyKey: key });
      }}
    >
      <label className="block text-[11px] text-foreground">Data de assinatura do termo
        <input type="date" required value={signedOn} onChange={(e) => setSignedOn(e.target.value)} className="mt-0.5 w-full rounded border border-border px-1 py-0.5 text-xs" />
      </label>
      <input required value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Referência do termo assinado (nº/processo)" className="w-full rounded border border-border px-1 py-0.5 text-xs" />
      {needsOpinion && <input required value={opinionId} onChange={(e) => setOpinionId(e.target.value)} placeholder="Solicitação de parecer vinculada" className="w-full rounded border border-border px-1 py-0.5 text-xs" />}
      <p className="text-[10px] text-muted-foreground">Ao registrar, o aditivo {addendum.sequence} passa a produzir efeitos no contrato (status e, se de prazo, vigência e alertas).</p>
      <button type="submit" disabled={formalize.isPending || !signedOn || reference.trim().length < 3} className="w-full rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white disabled:bg-muted disabled:text-muted-foreground">
        {formalize.isPending ? "Registrando…" : "Registrar formalização"}
      </button>
      {formalize.error && <p role="alert" className="text-[11px] text-red-700 dark:text-red-300">{formalize.error.message}</p>}
    </form>
  );
}

export default function AddendumWorkspace({ contractId, addenda = [], currentEndDate = null }: AddendumWorkspaceProps) {
  const utils = trpc.useUtils();
  const [addendumType, setAddendumType] = React.useState<"prazo" | "valor" | "quantitativo" | "qualitativo">("prazo");
  const [requestOrigin, setRequestOrigin] = React.useState<Origin>("contract_workspace");
  const [justification, setJustification] = React.useState("");
  const [newValue, setNewValue] = React.useState("");
  const [newTerm, setNewTerm] = React.useState("");
  const [newEndDate, setNewEndDate] = React.useState("");

  // SEM084-B — uma chave por tentativa lógica: o retry (inclusive após erro) reusa a MESMA chave e converge para o
  // mesmo aditivo; só um novo aditivo, depois do sucesso, recebe chave nova.
  const { key: idempotencyKey, rotate } = useIdempotencyKey();
  const create = trpc.contractWorkspace.createAddendum.useMutation({
    onSuccess: () => { rotate(); void utils.contractWorkspace.loadContract.invalidate({ contractId }); setJustification(""); setNewValue(""); setNewTerm(""); setNewEndDate(""); },
  });

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Termos Aditivos</h3>

      <form onSubmit={(e) => { e.preventDefault(); if (justification.trim()) create.mutate({ contractId, addendumType, justification, newValue: newValue ? Number(newValue) : undefined, newTerm: newTerm || undefined, ...(addendumType === "prazo" && newEndDate ? { newEndDate } : {}), requestOrigin, idempotencyKey }); }} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setAddendumType(t)} className={`rounded-full border px-3 py-1 text-xs font-medium transition ${addendumType === t ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200" : "border-border text-muted-foreground hover:border-indigo-300"}`}>{ADDENDUM_TYPE_LABELS[t]}</button>
          ))}
        </div>
        <label className="block text-xs font-medium text-foreground">Origem da solicitação
          <select value={requestOrigin} onChange={(e) => setRequestOrigin(e.target.value as Origin)} className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none">
            {ORIGINS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2} placeholder="Justificativa do aditivo…" className="w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <div className="grid grid-cols-2 gap-2">
          {addendumType === "valor" && <input type="number" step="0.01" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Novo valor (R$)" className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />}
          {addendumType === "prazo" && <input value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="Nova vigência (texto, ex.: 12 meses)" className="rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />}
          {addendumType === "prazo" && (
            <label className="block text-xs font-medium text-foreground">Novo término da vigência
              <input type="date" aria-label="Novo término da vigência" value={newEndDate} onChange={(e) => setNewEndDate(e.target.value)} className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
            </label>
          )}
        </div>
        {addendumType === "prazo" && (
          <p className="text-[11px] text-muted-foreground" data-testid="addendum-expiration-hint">
            {currentEndDate ? `Vigência vigente: término em ${currentEndDate}. ` : "Este contrato ainda não tem término acompanhado. "}
            O novo término informado entra na minuta como PROPOSTA; o vencimento e os alertas (90/60/30/15/7 dias) só são reagendados quando o aditivo for formalizado.
          </p>
        )}
        <button type="submit" disabled={create.isPending || !justification.trim()} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
          {create.isPending ? "Gerando…" : "Criar aditivo + minuta"}
        </button>
        {create.data && <p className="text-xs text-muted-foreground" role="status" data-testid="addendum-created-preparatory">Minuta registrada. Nenhum efeito no contrato até a formalização{create.data.proposedEndDate ? ` (término proposto: ${create.data.proposedEndDate})` : ""}.</p>}
        {create.data?.requiresLegalOpinion && <p className="text-xs text-amber-700 dark:text-amber-300">Este aditivo requer parecer jurídico concluído e vinculado ao contrato antes da formalização.</p>}
        {/* SEM-025 — recusa governada da máquina de estados do contrato (ex.: contrato rescindido) nunca é silenciosa. */}
        {create.error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{create.error.message}</p>}
      </form>

      {addenda.length > 0 && (
        <ul className="divide-y divide-border">
          {addenda.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium text-foreground">Aditivo {a.sequence} — {ADDENDUM_TYPE_LABELS[a.addendumType] ?? a.addendumType}</p>
                <p className="line-clamp-1 text-xs text-muted-foreground">{a.justification}</p>
                {a.requestOrigin && <p className="text-[11px] text-muted-foreground">Origem: {ORIGIN_LABELS[a.requestOrigin] ?? a.requestOrigin}{a.requestOrigin === "documento_externo" ? " · declarado, não verificado" : ""}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{ADDENDUM_STATUS_LABELS[a.status] ?? a.status}</span>
                {(a.status === "minuta" || a.status === "aguardando_parecer") && <FormalizeAddendumForm contractId={contractId} addendum={a} />}
                {a.status === "finalizado" && a.documentReference && <p className="max-w-xs text-right text-[11px] text-muted-foreground">{a.documentReference}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
