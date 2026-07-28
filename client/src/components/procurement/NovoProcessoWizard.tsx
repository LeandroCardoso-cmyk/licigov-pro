import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

/**
 * NovoProcessoWizard — REAL (wired to tRPC).
 *
 * UX: em vez de um grande formulário, o operador informa o essencial
 * (número + objeto) e escolhe COMO deseja iniciar. O sistema assume a partir daí.
 *
 * PR B: contraste dark mode via tokens semânticos; a mensagem de erro exibe o
 * texto amigável em pt-BR retornado pelo servidor (sem mascarar o erro técnico,
 * que é logado no backend com correlationId).
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
  /** Recebe o processId e a forma de início escolhida (para abrir na etapa certa). */
  onCreated?: (processId: string, startOption: StartOption) => void;
};

export default function NovoProcessoWizard({
  onCreated,
}: NovoProcessoWizardProps) {
  const [processNumber, setProcessNumber] = useState("");
  const [object, setObject] = useState("");
  const [startOption, setStartOption] = useState<StartOption | null>(null);

  const createProcess = trpc.procurementProcess.createProcess.useMutation({
    onSuccess: (result) => {
      onCreated?.(result.process.id, result.process.startOption as StartOption);
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
      <h1 className="text-2xl font-semibold text-foreground">Novo Processo</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Informe o essencial e escolha como deseja iniciar. O restante é
        assistido.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-foreground">
            Número do processo
          </span>
          <input
            type="text"
            value={processNumber}
            onChange={(e) => setProcessNumber(e.target.value)}
            placeholder="2026/0001"
            className="rounded-lg border border-input bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="flex flex-col text-sm sm:col-span-2">
          <span className="mb-1 font-medium text-foreground">Objeto</span>
          <input
            type="text"
            value={object}
            onChange={(e) => setObject(e.target.value)}
            placeholder="Aquisição de equipamentos de informática"
            className="rounded-lg border border-input bg-background px-3 py-2 text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      </div>

      <h2 className="mt-8 text-lg font-medium text-foreground">
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
              className={`rounded-xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selected
                  ? "border-primary bg-primary/5 ring-2 ring-ring"
                  : "border-border bg-card hover:border-primary/40"
              }`}
            >
              <p className="font-medium text-foreground">{opt.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{opt.description}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {createProcess.isPending ? "Criando..." : "Criar processo"}
        </button>
        {createProcess.isError && (
          <span className="text-sm text-destructive">
            {createProcess.error?.message ||
              "Erro ao criar o processo. Tente novamente."}
          </span>
        )}
      </div>

      {created && (
        <div className="mt-6 rounded-xl border border-green-500/30 bg-green-500/10 p-4">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            Processo criado com sucesso.
          </p>
          <p className="mt-1 font-mono text-sm text-green-700 dark:text-green-400">
            {created.processNumber}
          </p>
        </div>
      )}
    </form>
  );
}
