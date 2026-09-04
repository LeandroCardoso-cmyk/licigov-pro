import React from "react";
import { trpc } from "../../lib/trpc";

/**
 * NewDirectProcurementWizard — REAL (tRPC).
 *
 * Assistente de nova Contratação Direta: como iniciar (DFD opcional), modalidade
 * (Dispensa/Inexigibilidade) e dados básicos. O Adaptive Process Engine define as
 * etapas seguintes automaticamente.
 */

export interface NewDirectProcurementWizardProps {
  onCreated?: (workspaceId: string) => void;
}

const START_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "criar_dfd", label: "Criar DFD" },
  { value: "importar_dfd", label: "Importar DFD" },
  { value: "importar_pdf", label: "Importar PDF" },
  { value: "importar_memorando", label: "Importar Memorando" },
  { value: "importar_oficio", label: "Importar Ofício" },
  { value: "sem_dfd", label: "Iniciar sem DFD" },
];

export default function NewDirectProcurementWizard({ onCreated }: NewDirectProcurementWizardProps) {
  const utils = trpc.useUtils();
  const [step, setStep] = React.useState(1);
  const [startOption, setStartOption] = React.useState("criar_dfd");
  const [procurementType, setProcurementType] = React.useState<"dispensa" | "inexigibilidade">("dispensa");
  const [processNumber, setProcessNumber] = React.useState("");
  const [object, setObject] = React.useState("");

  const create = trpc.directProcurement.createProcess.useMutation({
    onSuccess: (res) => {
      void utils.directProcurement.listProcesses.invalidate();
      onCreated?.(res.workspace.id);
    },
  });

  const canSubmit = processNumber.trim() && object.trim();

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Nova Contratação Direta</h2>
        <span className="text-xs text-muted-foreground">Etapa {step} de 3</span>
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Como deseja iniciar?</p>
          <div className="grid grid-cols-2 gap-2">
            {START_OPTIONS.map((o) => (
              <button key={o.value} type="button" onClick={() => setStartOption(o.value)}
                className={`rounded-md border px-3 py-2 text-xs font-medium transition ${startOption === o.value ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200" : "border-border text-muted-foreground hover:border-indigo-300"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setStep(2)} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Continuar</button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Modalidade</p>
          <div className="grid grid-cols-2 gap-2">
            {(["dispensa", "inexigibilidade"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setProcurementType(t)}
                className={`rounded-md border px-3 py-3 text-sm font-medium capitalize transition ${procurementType === t ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200" : "border-border text-muted-foreground hover:border-indigo-300"}`}>
                {t === "dispensa" ? "Dispensa" : "Inexigibilidade"}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(1)} className="flex-1 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">Voltar</button>
            <button type="button" onClick={() => setStep(3)} className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Continuar</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) create.mutate({ processNumber, object, procurementType, startOption: startOption as "criar_dfd" }); }} className="space-y-3">
          <label className="block text-xs font-medium text-foreground">Número do processo
            <input value={processNumber} onChange={(e) => setProcessNumber(e.target.value)} placeholder="2026/0001"
              className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
          </label>
          <label className="block text-xs font-medium text-foreground">Objeto
            <textarea value={object} onChange={(e) => setObject(e.target.value)} rows={2}
              className="mt-1 w-full resize-y rounded-md border border-border px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none" />
          </label>
          {create.isError && <p className="rounded-md border border-red-100 dark:border-red-900 bg-red-50 dark:bg-red-950 px-3 py-2 text-xs text-red-600 dark:text-red-400">{create.error.message}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep(2)} className="flex-1 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">Voltar</button>
            <button type="submit" disabled={!canSubmit || create.isPending} className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {create.isPending ? "Criando…" : "Criar processo"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
