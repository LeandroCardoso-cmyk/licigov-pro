import React from "react";
import { trpc } from "../../lib/trpc";
import { CONCLUSION_LABELS } from "./labels";

/**
 * LegalOpinionEditor — REAL (tRPC).
 *
 * Editor do parecer. Todo o conteúdo é editável e revisável (nunca automático):
 * relatório, fundamentação, conclusão, recomendações e ressalvas. Cria o rascunho
 * (createDraft) e depois atualiza (updateOpinion), gerando novas versões.
 */

export interface LegalOpinionEditorProps {
  workspaceId?: string;
  hasDraft?: boolean;
  onSaved?: (workspaceId: string) => void;
}

const OPINION_TYPES: Array<{ value: "LEGAL_OPINION_INITIAL" | "LEGAL_OPINION_FINAL"; label: string }> = [
  { value: "LEGAL_OPINION_INITIAL", label: "Parecer Inicial" },
  { value: "LEGAL_OPINION_FINAL", label: "Parecer Final" },
];
const CONCLUSIONS: Array<"favoravel" | "desfavoravel" | "com_ressalvas" | "parcialmente_favoravel"> =
  ["favoravel", "desfavoravel", "com_ressalvas", "parcialmente_favoravel"];

export default function LegalOpinionEditor({ workspaceId = "", hasDraft = false, onSaved }: LegalOpinionEditorProps) {
  const enabled = workspaceId.trim().length > 0;
  const utils = trpc.useUtils();

  const [opinionType, setOpinionType] = React.useState<"LEGAL_OPINION_INITIAL" | "LEGAL_OPINION_FINAL">("LEGAL_OPINION_INITIAL");
  const [report, setReport] = React.useState("");
  const [foundation, setFoundation] = React.useState("");
  const [conclusion, setConclusion] = React.useState("");
  const [conclusionType, setConclusionType] = React.useState<"favoravel" | "desfavoravel" | "com_ressalvas" | "parcialmente_favoravel">("favoravel");

  const onDone = () => {
    void utils.legalOpinionWorkspace.loadContext.invalidate({ workspaceId });
    onSaved?.(workspaceId);
  };
  const createDraft = trpc.legalOpinionWorkspace.createDraft.useMutation({ onSuccess: onDone });
  const updateOpinion = trpc.legalOpinionWorkspace.updateOpinion.useMutation({ onSuccess: onDone });

  if (!enabled) {
    return <div className="rounded-lg border border-dashed border-gray-200 bg-white p-6 text-center text-sm text-gray-400">Selecione um trabalho para elaborar o parecer.</div>;
  }

  const busy = createDraft.isPending || updateOpinion.isPending;
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasDraft) {
      updateOpinion.mutate({ workspaceId, report, foundation, conclusion, conclusionType });
    } else {
      createDraft.mutate({ workspaceId, opinionType, report, foundation, conclusion, conclusionType });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{hasDraft ? "Editar parecer" : "Elaborar parecer"}</h3>
        {!hasDraft && (
          <select value={opinionType} onChange={(e) => setOpinionType(e.target.value as typeof opinionType)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-800 focus:border-indigo-400 focus:outline-none">
            {OPINION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        )}
      </div>

      <label className="block text-xs font-medium text-gray-700">Relatório
        <textarea value={report} onChange={(e) => setReport(e.target.value)} rows={4}
          className="mt-1 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      <label className="block text-xs font-medium text-gray-700">Fundamentação (Lei 14.133/2021)
        <textarea value={foundation} onChange={(e) => setFoundation(e.target.value)} rows={5}
          className="mt-1 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-gray-700">Conclusão
          <textarea value={conclusion} onChange={(e) => setConclusion(e.target.value)} rows={2}
            className="mt-1 w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        </label>
        <label className="block text-xs font-medium text-gray-700">Tipo de conclusão
          <select value={conclusionType} onChange={(e) => setConclusionType(e.target.value as typeof conclusionType)}
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none">
            {CONCLUSIONS.map((c) => <option key={c} value={c}>{CONCLUSION_LABELS[c]}</option>)}
          </select>
        </label>
      </div>

      {(createDraft.isError || updateOpinion.isError) && (
        <p className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-600">
          {createDraft.error?.message ?? updateOpinion.error?.message}
        </p>
      )}

      <button type="submit" disabled={busy}
        className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50">
        {busy ? "Salvando…" : hasDraft ? "Salvar nova versão" : "Criar parecer"}
      </button>
      <p className="text-[11px] text-gray-400">Todo conteúdo é editável e revisável — o sistema nunca emite parecer automaticamente.</p>
    </form>
  );
}
