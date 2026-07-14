import React from "react";
import { trpc } from "../../lib/trpc";
import { RECORD_TYPE_LABELS } from "./labels";

/**
 * LegacyImportWizard — REAL (tRPC).
 *
 * Importação Assistida de processo/contrato legado: PDF/DOCX (convertido em texto)
 * → extração determinística assistida → o servidor confirma → registrado como
 * Origem Externa. O sistema nunca transmite ideia de reconstrução perfeita.
 */

export interface LegacyImportWizardProps { onImported?: (recordId: string) => void }

const TYPES = ["processo_licitatorio_legado", "contratacao_direta_legada", "contrato_externo", "aditivo_externo", "ata_externa", "parecer_externo"] as const;

export default function LegacyImportWizard({ onImported }: LegacyImportWizardProps) {
  const utils = trpc.useUtils();
  const [recordType, setRecordType] = React.useState<(typeof TYPES)[number]>("processo_licitatorio_legado");
  const [rawText, setRawText] = React.useState("");

  const importLegacy = trpc.operationRecord.importLegacy.useMutation({
    onSuccess: (res) => {
      void utils.operationRecord.listRecords.invalidate();
      void utils.departmentOperation.timeline.invalidate();
      onImported?.(res.record.id);
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (rawText.trim()) importLegacy.mutate({ recordType, rawText }); }}
      className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
      <h2 className="text-base font-semibold text-gray-900">Importação Assistida</h2>
      <p className="text-xs text-gray-400">Cole o texto do documento (PDF/DOCX). O sistema sugere os campos; você confirma.</p>

      <label className="block text-xs font-medium text-gray-700">Tipo
        <select value={recordType} onChange={(e) => setRecordType(e.target.value as typeof recordType)} className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none">
          {TYPES.map((t) => <option key={t} value={t}>{RECORD_TYPE_LABELS[t]}</option>)}
        </select>
      </label>
      <textarea value={rawText} onChange={(e) => setRawText(e.target.value)} rows={5} placeholder="Cole aqui o texto do documento legado…" className="w-full resize-y rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />

      {importLegacy.data && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium">Importado (assistido) — confiança {Math.round(importLegacy.data.confidence * 100)}%.</p>
          <p className="mt-0.5">{importLegacy.data.disclaimer}</p>
        </div>
      )}
      <button type="submit" disabled={importLegacy.isPending || !rawText.trim()} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {importLegacy.isPending ? "Importando…" : "Importar (assistido)"}
      </button>
    </form>
  );
}
