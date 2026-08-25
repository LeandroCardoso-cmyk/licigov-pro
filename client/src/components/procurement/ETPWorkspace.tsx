import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIngestionCapabilities } from "@/hooks/ingestion/useIngestionCapabilities";
import { DocumentIngestionLauncher } from "@/components/ingestion/DocumentIngestionLauncher";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

/**
 * ETPWorkspace — REAL (wired to tRPC).
 *
 * UX: o operador informa o objeto e o sistema GERA um rascunho a partir do processo.
 * Toda saída de IA é editável, revisável e validada por humano — daí o banner.
 *
 * B.2.2 — ações distintas: "Gerar ETP a partir do processo" (existente) e "Importar ETP existente"
 * (ingestão canônica supervisionada, capability-aware). NÃO há geração jurídica autônoma nem
 * promoção ao domínio. Observação: não existe contrato de backend para "criar ETP manualmente"
 * nem persistência de ETP (apenas generateETP) — registrado para B.2.3/B.2.4, sem fabricar aqui.
 */

export type ETPWorkspaceProps = {
  processId?: string;
};

export default function ETPWorkspace({ processId = "" }: ETPWorkspaceProps) {
  const [object, setObject] = useState("");
  const { enabled: ingestionEnabled } = useIngestionCapabilities();

  const { key: etpKey, rotate: rotateEtpKey } = useIdempotencyKey();
  const generateETP = trpc.procurementProcess.generateETP.useMutation({ onSuccess: () => rotateEtpKey() });
  const draft = generateETP.data?.document;

  const handleGenerate = () => {
    if (!processId || !object.trim()) return;
    generateETP.mutate({ processId, object: object.trim(), idempotencyKey: etpKey });
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold text-foreground">
        ETP — Estudo Técnico Preliminar
      </h1>
      <p className="text-sm text-muted-foreground">Art. 18 da Lei 14.133/2021</p>

      <div className="mt-5 rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 font-medium text-foreground">Gerar ETP a partir do processo</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          O sistema estrutura um rascunho a partir do objeto informado. Rascunho editável e sujeito
          a revisão humana — nunca um documento oficial automático.
        </p>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-foreground">Objeto</span>
          <input
            type="text"
            value={object}
            onChange={(e) => setObject(e.target.value)}
            placeholder="Contratação de solução de conectividade"
            className="rounded-lg border border-input px-3 py-2 focus-visible:ring-2 focus-visible:ring-ring focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!processId || !object.trim() || generateETP.isPending}
          className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {generateETP.isPending ? "Gerando..." : "Gerar rascunho de ETP"}
        </button>
        {!processId && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Selecione um processo para gerar o ETP.
          </p>
        )}
        {generateETP.isError && (
          <p className="mt-2 text-sm text-destructive">Falha ao gerar o ETP.</p>
        )}
      </div>

      {/* Importar ETP existente — ingestão canônica supervisionada, capability-aware (B.2.2).
          PDF/DOCX ainda são stub (B.2.3): a importação aparece como indisponível de forma objetiva,
          sem ofertar formatos alheios nem fluxo sem resultado. Só exposta com a flag ligada. */}
      {ingestionEnabled && (
        <div className="mt-5">
          <DocumentIngestionLauncher
            importType="generic"
            procurementProcessId={processId}
            importPurpose="etp_import"
            title="Importar ETP existente"
            description="A importação assistida de ETP passará por revisão humana antes de qualquer uso."
            relevantFormatKeys={["pdf", "docx"]}
            allowPaste={false}
          />
        </div>
      )}

      {draft && (
        <div className="mt-6">
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Revisão obrigatória.</strong> Este é um rascunho gerado por
            IA. Revise e valide antes de utilizar.
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
