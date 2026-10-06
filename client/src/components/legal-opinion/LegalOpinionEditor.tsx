import React from "react";
import { trpc } from "../../lib/trpc";
import { CONCLUSION_LABELS } from "./labels";
import { buildSavePatch, hydrationKey, useHydratedForm } from "../../lib/formHydration";

/**
 * LegalOpinionEditor — REAL (tRPC).
 *
 * Editor do parecer. Todo o conteúdo é editável e revisável (nunca automático):
 * relatório, fundamentação, conclusão, recomendações e ressalvas. Cria o rascunho
 * (createDraft) e depois atualiza (updateOpinion), gerando novas versões.
 *
 * R5 / PR-10 (SEM-019): o editor HIDRATA o parecer persistido (nunca abre em branco sobre um existente), não impõe
 * tipo de conclusão (sem "Favorável" pré-selecionado — a escolha é explícita), não permite salvar antes da hidratação,
 * envia só os campos alterados e não vazios (salvar vazio não apaga) com a versão lida (CAS), e rehidrata quando a
 * versão persistida muda (reload estável). Guard transversal: `client/src/lib/formHydration.ts` (R5.1).
 */

export interface LegalOpinionDraftView {
  id: string;
  version: number;
  report: string;
  foundation: string;
  conclusion: string;
  conclusionType: string | null;
}

export interface LegalOpinionEditorProps {
  workspaceId?: string;
  hasDraft?: boolean;
  /** Parecer persistido (loadContext.draft). Fonte da hidratação. */
  draft?: LegalOpinionDraftView | null;
  /** O contexto ainda está carregando — o editor não aceita envio antes de hidratar. */
  loading?: boolean;
  onSaved?: (workspaceId: string) => void;
}

const OPINION_TYPES: Array<{ value: "LEGAL_OPINION_INITIAL" | "LEGAL_OPINION_FINAL"; label: string }> = [
  { value: "LEGAL_OPINION_INITIAL", label: "Parecer Inicial" },
  { value: "LEGAL_OPINION_FINAL", label: "Parecer Final" },
];
type ConclusionType = "favoravel" | "desfavoravel" | "com_ressalvas" | "parcialmente_favoravel";
const CONCLUSIONS: ConclusionType[] = ["favoravel", "desfavoravel", "com_ressalvas", "parcialmente_favoravel"];
/** Vazio NEUTRO: nenhum campo decisório tem default (conclusão não escolhida = ""). */
const EMPTY = { report: "", foundation: "", conclusion: "", conclusionType: "" };

export default function LegalOpinionEditor({ workspaceId = "", hasDraft = false, draft = null, loading = false, onSaved }: LegalOpinionEditorProps) {
  const enabled = workspaceId.trim().length > 0;
  const utils = trpc.useUtils();

  const [opinionType, setOpinionType] = React.useState<"LEGAL_OPINION_INITIAL" | "LEGAL_OPINION_FINAL">("LEGAL_OPINION_INITIAL");
  const server = draft ? { report: draft.report, foundation: draft.foundation, conclusion: draft.conclusion, conclusionType: draft.conclusionType ?? "" } : null;
  const form = useHydratedForm({ server, empty: EMPTY, key: hydrationKey(workspaceId, draft?.id, draft?.version), loading: loading || (hasDraft && !draft) });
  const { report, foundation, conclusion, conclusionType } = form.values;

  const onDone = () => {
    void utils.legalOpinionWorkspace.loadContext.invalidate({ workspaceId });
    onSaved?.(workspaceId);
  };
  // R3 / PR-06 — CONFLICT (parecer já existe/assinado): a mensagem do servidor é exibida e o contexto é recarregado,
  // para a tela refletir o parecer existente em vez de oferecer uma nova "criação".
  const createDraft = trpc.legalOpinionWorkspace.createDraft.useMutation({
    onSuccess: onDone,
    onError: (e) => { if (e.data?.code === "CONFLICT") void utils.legalOpinionWorkspace.loadContext.invalidate({ workspaceId }); },
  });
  const updateOpinion = trpc.legalOpinionWorkspace.updateOpinion.useMutation({ onSuccess: onDone });

  if (!enabled) {
    return <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">Selecione um trabalho para elaborar o parecer.</div>;
  }

  const busy = createDraft.isPending || updateOpinion.isPending;
  const patch = buildSavePatch(server, form.values);
  const nothingToSave = hasDraft && Object.keys(patch).length === 0;
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.ready) return;
    if (hasDraft) {
      if (nothingToSave || !draft) return;
      updateOpinion.mutate({
        workspaceId, expectedVersion: draft.version,
        ...(patch.report !== undefined ? { report: patch.report as string } : {}),
        ...(patch.foundation !== undefined ? { foundation: patch.foundation as string } : {}),
        ...(patch.conclusion !== undefined ? { conclusion: patch.conclusion as string } : {}),
        ...(patch.conclusionType ? { conclusionType: patch.conclusionType as ConclusionType } : {}),
      });
    } else {
      createDraft.mutate({ workspaceId, opinionType, report, foundation, conclusion, ...(conclusionType ? { conclusionType: conclusionType as ConclusionType } : {}) });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{hasDraft ? "Editar parecer" : "Elaborar parecer"}</h3>
        {!hasDraft && (
          <select value={opinionType} onChange={(e) => setOpinionType(e.target.value as typeof opinionType)}
            className="rounded-md border border-border px-2 py-1 text-xs text-foreground focus:border-indigo-400 focus:outline-none">
            {OPINION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        )}
      </div>

      <label className="block text-xs font-medium text-foreground">Relatório
        <textarea value={report ?? ""} onChange={(e) => form.setField("report", e.target.value)} rows={4}
          className="mt-1 w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      <label className="block text-xs font-medium text-foreground">Fundamentação (Lei 14.133/2021)
        <textarea value={foundation ?? ""} onChange={(e) => form.setField("foundation", e.target.value)} rows={5}
          className="mt-1 w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-foreground">Conclusão
          <textarea value={conclusion ?? ""} onChange={(e) => form.setField("conclusion", e.target.value)} rows={2}
            className="mt-1 w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        </label>
        <label className="block text-xs font-medium text-foreground">Tipo de conclusão
          <select value={conclusionType ?? ""} onChange={(e) => form.setField("conclusionType", e.target.value)}
            className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none">
            <option value="">Selecione (decisão do procurador)…</option>
            {CONCLUSIONS.map((c) => <option key={c} value={c}>{CONCLUSION_LABELS[c]}</option>)}
          </select>
        </label>
      </div>

      {(createDraft.isError || updateOpinion.isError) && (
        <p className="rounded-md border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-600 dark:text-red-400">
          {createDraft.error?.message ?? updateOpinion.error?.message}
        </p>
      )}

      {hasDraft && form.ready && nothingToSave && (
        <p className="text-[11px] text-muted-foreground">Nenhuma alteração em relação à versão {draft?.version}. Campos deixados em branco não apagam o conteúdo salvo.</p>
      )}
      <button type="submit" disabled={busy || !form.ready || nothingToSave}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground">
        {!form.ready ? "Carregando parecer…" : busy ? "Salvando…" : hasDraft ? "Salvar nova versão" : "Criar parecer"}
      </button>
      <p className="text-[11px] text-muted-foreground">Todo conteúdo é editável e revisável — o sistema nunca emite parecer automaticamente.</p>
    </form>
  );
}
