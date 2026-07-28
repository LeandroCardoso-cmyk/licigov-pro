import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

/**
 * EditalWorkspace — REAL (wired to tRPC).
 *
 * UX: seleção guiada (modalidade + forma). Presencial gera justificativa legal
 * automática; eletrônico exige plataforma. O servidor valida e monta o edital —
 * o operador apenas revisa.
 */

type Modality =
  | "pregao"
  | "concorrencia"
  | "leilao"
  | "concurso"
  | "chamada_publica"
  | "credenciamento"
  | "registro_de_precos";
type Form = "eletronico" | "presencial";
type Platform =
  | "compras_gov"
  | "bll"
  | "licitanet"
  | "portal_proprio"
  | "outra";

const MODALITY_LABELS: Record<Modality, string> = {
  pregao: "Pregão",
  concorrencia: "Concorrência",
  leilao: "Leilão",
  concurso: "Concurso",
  chamada_publica: "Chamada Pública",
  credenciamento: "Credenciamento",
  registro_de_precos: "Registro de Preços",
};

const FORM_LABELS: Record<Form, string> = {
  eletronico: "Eletrônico",
  presencial: "Presencial",
};

const PLATFORM_LABELS: Record<Platform, string> = {
  compras_gov: "Compras.gov.br",
  bll: "BLL",
  licitanet: "LicitaNet",
  portal_proprio: "Portal próprio",
  outra: "Outra",
};

export type EditalWorkspaceProps = {
  processId?: string;
};

export default function EditalWorkspace({
  processId = "",
}: EditalWorkspaceProps) {
  const [object, setObject] = useState("");
  const [modality, setModality] = useState<Modality>("pregao");
  const [form, setForm] = useState<Form>("eletronico");
  const [platform, setPlatform] = useState<Platform>("compras_gov");

  const generateNotice = trpc.procurementProcess.generateNotice.useMutation();
  const draft = generateNotice.data?.document;

  const handleGenerate = () => {
    if (!processId || !object.trim()) return;
    generateNotice.mutate({
      processId,
      object: object.trim(),
      modality,
      form,
      platform: form === "eletronico" ? platform : undefined,
    });
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">Edital</h1>
      <p className="text-sm text-muted-foreground">
        Modalidade, forma e critério montados pelo sistema conforme a Lei
        14.133/2021.
      </p>

      <div className="mt-5 space-y-4 rounded-xl border border-border bg-card p-5">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-foreground">Objeto</span>
          <input
            type="text"
            value={object}
            onChange={(e) => setObject(e.target.value)}
            placeholder="Registro de preços para materiais de expediente"
            className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium text-foreground">Modalidade</span>
            <select
              value={modality}
              onChange={(e) => setModality(e.target.value as Modality)}
              className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              {(Object.keys(MODALITY_LABELS) as Modality[]).map((m) => (
                <option key={m} value={m}>
                  {MODALITY_LABELS[m]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium text-foreground">Forma</span>
            <select
              value={form}
              onChange={(e) => setForm(e.target.value as Form)}
              className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              {(Object.keys(FORM_LABELS) as Form[]).map((f) => (
                <option key={f} value={f}>
                  {FORM_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {form === "presencial" ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Justificativa legal automática.</strong> A forma presencial
            exige justificativa (art. 17, § 2º). O sistema a incluirá
            automaticamente no edital.
          </div>
        ) : (
          <label className="flex flex-col text-sm sm:max-w-xs">
            <span className="mb-1 font-medium text-foreground">Plataforma</span>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value as Platform)}
              className="rounded-lg border border-input px-3 py-2 focus:border-blue-500 focus:outline-none"
            >
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={!processId || !object.trim() || generateNotice.isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {generateNotice.isPending ? "Gerando..." : "Gerar edital"}
        </button>
        {!processId && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Selecione um processo para gerar o edital.
          </p>
        )}
        {generateNotice.isError && (
          <p className="text-sm text-destructive">
            {generateNotice.error.message || "Falha ao gerar o edital."}
          </p>
        )}
      </div>

      {draft && (
        <div className="mt-6">
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Revisão obrigatória.</strong> Edital gerado pelo sistema.
            Revise antes de publicar.
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-2 font-semibold text-foreground">{draft.title}</h2>
            <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">
              {draft.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
