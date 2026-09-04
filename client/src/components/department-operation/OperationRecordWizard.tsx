import React from "react";
import { trpc } from "../../lib/trpc";
import { RECORD_TYPE_LABELS } from "./labels";

/**
 * OperationRecordWizard — REAL (tRPC).
 *
 * Cadastro Rápido de um registro operacional legado/manual — processo completo OU
 * apenas uma parte (só um contrato, só uma reunião…). Nunca obriga reconstrução
 * completa. Origem interna ou externa.
 */

export interface OperationRecordWizardProps { onCreated?: (recordId: string) => void }

const TYPES = ["processo_licitatorio_legado", "contratacao_direta_legada", "contrato_externo", "aditivo_externo", "ata_externa", "parecer_externo", "reuniao", "evento", "tarefa", "outro"] as const;

export default function OperationRecordWizard({ onCreated }: OperationRecordWizardProps) {
  const utils = trpc.useUtils();
  const [recordType, setRecordType] = React.useState<(typeof TYPES)[number]>("contrato_externo");
  const [origin, setOrigin] = React.useState<"interna" | "externa">("externa");
  const [number, setNumber] = React.useState("");
  const [object, setObject] = React.useState("");
  const [modality, setModality] = React.useState("");
  const [currentStage, setCurrentStage] = React.useState("");

  const create = trpc.operationRecord.createRecord.useMutation({
    onSuccess: (res) => {
      void utils.operationRecord.listRecords.invalidate();
      void utils.departmentOperation.timeline.invalidate();
      onCreated?.(res.record.id);
      setNumber(""); setObject(""); setModality(""); setCurrentStage("");
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); create.mutate({ recordType, origin, number: number || undefined, object: object || undefined, modality: modality || undefined, currentStage: currentStage || undefined }); }}
      className="space-y-3 rounded-xl border border-border bg-card p-5">
      <h2 className="text-base font-semibold text-foreground">Cadastro Rápido</h2>
      <p className="text-xs text-muted-foreground">Registre um item legado/externo — processo completo ou apenas uma parte.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-foreground">Tipo
          <select value={recordType} onChange={(e) => setRecordType(e.target.value as typeof recordType)} className="mt-1 w-full rounded-md border border-input px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none">
            {TYPES.map((t) => <option key={t} value={t}>{RECORD_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label className="block text-xs font-medium text-foreground">Origem
          <select value={origin} onChange={(e) => setOrigin(e.target.value as "interna" | "externa")} className="mt-1 w-full rounded-md border border-input px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none">
            <option value="externa">Externa</option>
            <option value="interna">Interna</option>
          </select>
        </label>
        <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Número" className="rounded-md border border-input px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
        <input value={modality} onChange={(e) => setModality(e.target.value)} placeholder="Modalidade" className="rounded-md border border-input px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      </div>
      <input value={object} onChange={(e) => setObject(e.target.value)} placeholder="Objeto" className="w-full rounded-md border border-input px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
      <input value={currentStage} onChange={(e) => setCurrentStage(e.target.value)} placeholder="Etapa atual (opcional)" className="w-full rounded-md border border-input px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />

      {create.isSuccess && <p className="text-xs text-green-700 dark:text-green-300">Registro criado.</p>}
      <button type="submit" disabled={create.isPending} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
        {create.isPending ? "Salvando…" : "Criar registro"}
      </button>
    </form>
  );
}
