import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

/**
 * NovoProcessoWizard — REAL (wired to tRPC).
 *
 * UX: em vez de um grande formulário, o operador informa o essencial
 * (número + objeto) e escolhe COMO deseja iniciar. O sistema assume a partir daí.
 */

type StartOption =
  | "criar_dfd"
  | "importar_dfd"
  | "importar_oficio"
  | "importar_memorando"
  | "importar_pdf"
  | "iniciar_etp";

const START_OPTIONS: { value: StartOption; title: string; description: string }[] =
  [
    {
      value: "criar_dfd",
      title: "Criar DFD do zero",
      description: "Documento de Formalização da Demanda assistido por IA.",
    },
    {
      value: "importar_dfd",
      title: "Importar DFD existente",
      description: "Traga um DFD já elaborado para dentro do processo.",
    },
    {
      value: "importar_oficio",
      title: "Importar de ofício",
      description: "Extraímos a demanda a partir de um ofício.",
    },
    {
      value: "importar_memorando",
      title: "Importar de memorando",
      description: "Extraímos a demanda a partir de um memorando.",
    },
    {
      value: "importar_pdf",
      title: "Importar PDF",
      description: "Envie um PDF e o sistema estrutura a demanda.",
    },
    {
      value: "iniciar_etp",
      title: "Iniciar direto no ETP",
      description: "Pule para o Estudo Técnico Preliminar.",
    },
  ];

export type NovoProcessoWizardProps = {
  onCreated?: (processId: string) => void;
};

export default function NovoProcessoWizard({
  onCreated,
}: NovoProcessoWizardProps) {
  const [processNumber, setProcessNumber] = useState("");
  const [object, setObject] = useState("");
  const [startOption, setStartOption] = useState<StartOption | null>(null);

  const createProcess = trpc.procurementProcess.createProcess.useMutation({
    onSuccess: (result) => {
      onCreated?.(result.process.id);
    },
  });

  const canSubmit =
    processNumber.trim().length > 0 &&
    object.trim().length > 0 &&
    startOption !== null &&
    !createProcess.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startOption) return;
    createProcess.mutate({
      processNumber: processNumber.trim(),
      object: object.trim(),
      startOption,
    });
  };

  const created = createProcess.data?.process;

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold text-gray-900">Novo Processo</h1>
      <p className="mt-1 text-sm text-gray-500">
        Informe o essencial e escolha como deseja iniciar. O restante é
        assistido.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-gray-700">
            Número do processo
          </span>
          <input
            type="text"
            value={processNumber}
            onChange={(e) => setProcessNumber(e.target.value)}
            placeholder="2026/0001"
            className="rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col text-sm sm:col-span-2">
          <span className="mb-1 font-medium text-gray-700">Objeto</span>
          <input
            type="text"
            value={object}
            onChange={(e) => setObject(e.target.value)}
            placeholder="Aquisição de equipamentos de informática"
            className="rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>
      </div>

      <h2 className="mt-8 text-lg font-medium text-gray-900">
        Como deseja iniciar?
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {START_OPTIONS.map((opt) => {
          const selected = startOption === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setStartOption(opt.value)}
              className={`rounded-xl border p-4 text-left transition ${
                selected
                  ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                  : "border-gray-200 bg-white hover:border-blue-300"
              }`}
            >
              <p className="font-medium text-gray-900">{opt.title}</p>
              <p className="mt-1 text-xs text-gray-500">{opt.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createProcess.isPending ? "Criando..." : "Criar processo"}
        </button>
        {createProcess.isError && (
          <span className="text-sm text-red-600">
            Erro ao criar o processo. Tente novamente.
          </span>
        )}
      </div>

      {created && (
        <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            Processo criado com sucesso.
          </p>
          <p className="mt-1 font-mono text-sm text-green-700">
            {created.processNumber}
          </p>
        </div>
      )}
    </form>
  );
}
