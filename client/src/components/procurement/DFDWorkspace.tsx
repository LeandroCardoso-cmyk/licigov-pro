import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

/**
 * DFDWorkspace — REAL (wired to tRPC).
 *
 * UX: baseada em REVISÃO. O DFD pode ser importado de várias fontes e então
 * validado — nunca um grande formulário manual.
 */

type DFDSource = "pdf" | "docx" | "oficio" | "memorando";
type DFDState =
  | "inexistente"
  | "importado"
  | "em_elaboracao"
  | "em_revisao"
  | "aprovado";

const DFD_STATE_LABELS: Record<DFDState, string> = {
  inexistente: "Inexistente",
  importado: "Importado",
  em_elaboracao: "Em elaboração",
  em_revisao: "Em revisão",
  aprovado: "Aprovado",
};

const DFD_STATE_CLASSES: Record<DFDState, string> = {
  inexistente: "bg-gray-100 text-gray-600",
  importado: "bg-blue-100 text-blue-700",
  em_elaboracao: "bg-indigo-100 text-indigo-700",
  em_revisao: "bg-amber-100 text-amber-700",
  aprovado: "bg-green-100 text-green-700",
};

const SOURCE_LABELS: Record<DFDSource, string> = {
  pdf: "PDF",
  docx: "DOCX",
  oficio: "Ofício",
  memorando: "Memorando",
};

export type DFDWorkspaceProps = {
  processId?: string;
};

export default function DFDWorkspace({ processId = "" }: DFDWorkspaceProps) {
  const [source, setSource] = useState<DFDSource>("pdf");
  const [state, setState] = useState<DFDState>("inexistente");

  const importDFD = trpc.procurementProcess.importDFD.useMutation({
    onSuccess: () => setState("importado"),
  });

  const handleImport = () => {
    if (!processId) return;
    importDFD.mutate({ processId, source });
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            DFD — Documento de Formalização da Demanda
          </h1>
          <p className="text-sm text-gray-500">Art. 12, § 1º da Lei 14.133/2021</p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${DFD_STATE_CLASSES[state]}`}
        >
          {DFD_STATE_LABELS[state]}
        </span>
      </div>

      {/* Trilha de estados possíveis do DFD */}
      <div className="mb-6 flex flex-wrap gap-2">
        {(Object.keys(DFD_STATE_LABELS) as DFDState[]).map((s) => (
          <span
            key={s}
            className={`rounded-md px-2 py-1 text-xs ${
              s === state
                ? DFD_STATE_CLASSES[s]
                : "bg-gray-50 text-gray-400"
            }`}
          >
            {DFD_STATE_LABELS[s]}
          </span>
        ))}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 font-medium text-gray-900">Importar DFD</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col text-sm">
            <span className="mb-1 font-medium text-gray-700">Fonte</span>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as DFDSource)}
              className="rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              {(Object.keys(SOURCE_LABELS) as DFDSource[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleImport}
            disabled={!processId || importDFD.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {importDFD.isPending ? "Importando..." : "Importar DFD"}
          </button>
        </div>
        {!processId && (
          <p className="mt-2 text-xs text-amber-600">
            Selecione um processo para importar o DFD.
          </p>
        )}
        {importDFD.isSuccess && (
          <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            DFD importado ({SOURCE_LABELS[source]}). Revise os campos extraídos
            antes de prosseguir.
          </p>
        )}
        {importDFD.isError && (
          <p className="mt-3 text-sm text-red-600">Falha ao importar o DFD.</p>
        )}
      </div>
    </div>
  );
}
