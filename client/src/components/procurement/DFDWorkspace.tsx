import { useEffect, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIngestionCapabilities } from "@/hooks/ingestion/useIngestionCapabilities";
import { DocumentIngestionLauncher } from "@/components/ingestion/DocumentIngestionLauncher";

/**
 * DFDWorkspace — REAL (wired to tRPC).
 *
 * UX: o DFD pode ser CRIADO do zero (rascunho estruturado editável, art. 12 §1º)
 * ou IMPORTADO de uma fonte. Ambos produzem um rascunho que o servidor revisa —
 * nunca um documento finalizado automaticamente. Contraste dark mode via tokens.
 */

type DFDSource = "pdf" | "docx" | "oficio" | "memorando";

const SOURCE_LABELS: Record<DFDSource, string> = {
  pdf: "PDF",
  docx: "DOCX",
  oficio: "Ofício",
  memorando: "Memorando",
};

const STATUS_LABELS: Record<string, string> = {
  rascunho: "Rascunho",
  em_revisao: "Em revisão",
  aprovado: "Aprovado",
};

export type DFDWorkspaceProps = {
  processId?: string;
};

export default function DFDWorkspace({ processId = "" }: DFDWorkspaceProps) {
  const utils = trpc.useUtils();
  const { enabled: ingestionEnabled } = useIngestionCapabilities();
  const [source, setSource] = useState<DFDSource>("pdf");
  const [draft, setDraft] = useState("");
  const loadedFor = useRef<string | null>(null);

  const { data, isLoading } = trpc.procurementProcess.loadDFD.useQuery(
    { processId },
    { enabled: !!processId },
  );
  const doc = data?.document ?? null;

  // Sincroniza o editor com o rascunho carregado (sem sobrescrever edições em curso).
  useEffect(() => {
    if (doc && loadedFor.current !== doc.id) {
      setDraft(doc.content);
      loadedFor.current = doc.id;
    }
    if (!doc) loadedFor.current = null;
  }, [doc]);

  const invalidate = () => {
    if (!processId) return;
    utils.procurementProcess.loadDFD.invalidate({ processId });
    utils.procurementProcess.loadProcess.invalidate({ processId }); // reflete na Visão Geral
  };

  const generateDFD = trpc.procurementProcess.generateDFD.useMutation({ onSuccess: invalidate });
  const saveDFD = trpc.procurementProcess.saveDFD.useMutation({ onSuccess: invalidate });
  const importDFD = trpc.procurementProcess.importDFD.useMutation({ onSuccess: invalidate });

  const state = doc ? (STATUS_LABELS[doc.status] ?? doc.status) : "Inexistente";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            DFD — Documento de Formalização da Demanda
          </h1>
          <p className="text-sm text-muted-foreground">Art. 12, § 1º da Lei 14.133/2021</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            doc ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {state}
        </span>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          <div className="h-24 rounded-xl bg-muted" />
          <div className="h-40 rounded-xl bg-muted" />
        </div>
      ) : !doc ? (
        <div className="space-y-4">
          {/* Criar do zero */}
          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="mb-1 font-medium text-foreground">Criar DFD do zero</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              O sistema estrutura um rascunho editável com as seções do art. 12, §1º.
              Você revisa e complementa antes de salvar.
            </p>
            <button
              type="button"
              onClick={() => processId && generateDFD.mutate({ processId })}
              disabled={!processId || generateDFD.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {generateDFD.isPending ? "Criando..." : "Criar DFD do zero"}
            </button>
            {generateDFD.isError && (
              <p className="mt-2 text-sm text-destructive">
                {generateDFD.error?.message || "Falha ao criar o DFD."}
              </p>
            )}
          </div>

          {/* Importar DFD existente — capability-aware (B.2.2).
              Com a ingestão canônica LIGADA, a importação usa a fundação supervisionada; como os
              parsers de PDF/DOCX ainda são stub (B.2.3), a ação é apresentada como indisponível de
              forma objetiva (sem ofertar formatos alheios ao DFD nem fluxo sem resultado). Com a
              flag DESLIGADA, o caminho legado permanece congelado. */}
          {ingestionEnabled ? (
            <DocumentIngestionLauncher
              importType="generic"
              importPurpose="dfd_import"
              title="Importar DFD existente"
              description="A importação assistida de DFD passará por revisão humana antes de qualquer uso."
              relevantFormatKeys={["pdf", "docx"]}
              allowPaste={false}
            />
          ) : (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 font-medium text-foreground">Importar DFD existente</h2>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <label className="flex flex-1 flex-col text-sm">
                  <span className="mb-1 font-medium text-foreground">Fonte</span>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as DFDSource)}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-foreground focus:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  onClick={() => processId && importDFD.mutate({ processId, source })}
                  disabled={!processId || importDFD.isPending}
                  className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                >
                  {importDFD.isPending ? "Importando..." : "Importar DFD"}
                </button>
              </div>
              {importDFD.isError && (
                <p className="mt-2 text-sm text-destructive">Falha ao importar o DFD.</p>
              )}
            </div>
          )}

          {!processId && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Selecione um processo para criar ou importar o DFD.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Revisão obrigatória.</strong> Rascunho estruturado do DFD. Revise,
            edite e salve. A geração assistida por IA plena é evolução futura.
          </div>
          <label className="flex flex-col text-sm">
            <span className="mb-1 font-medium text-foreground">Conteúdo do DFD</span>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={18}
              className="rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => processId && saveDFD.mutate({ processId, content: draft })}
              disabled={!processId || !draft.trim() || saveDFD.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {saveDFD.isPending ? "Salvando..." : "Salvar rascunho"}
            </button>
            {saveDFD.isSuccess && (
              <span className="text-sm text-green-600 dark:text-green-400">Rascunho salvo.</span>
            )}
            {saveDFD.isError && (
              <span className="text-sm text-destructive">
                {saveDFD.error?.message || "Falha ao salvar o rascunho."}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
