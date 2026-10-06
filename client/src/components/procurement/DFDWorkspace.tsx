import { useEffect, useRef, useState } from "react";
import { trpc } from "../../lib/trpc";
import { useIngestionCapabilities } from "@/hooks/ingestion/useIngestionCapabilities";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import { DocumentImportPanel } from "@/components/ingestion/DocumentImportPanel";
import { shouldRotateSaveKeyOnError } from "./saveKeyPolicy";
import DFDFieldSources from "./DFDFieldSources";
import DFDJustificationSuggestionPanel from "./DFDJustificationSuggestionPanel";
import {
  LEGACY_DFD_REGISTER_BUTTON, LEGACY_DFD_REGISTER_ERROR, LEGACY_DFD_REGISTER_NOTE, LEGACY_DFD_REGISTER_PENDING, LEGACY_DFD_REGISTER_TITLE,
  legacyDfdRegisteredMessage,
} from "./legacyDfdImportCopy";
import { acceptedMessage, buildAcceptInput, isSuggestionObsolete, type JustificationSuggestionUI } from "./dfdJustificationSuggestion";
import { shouldProceedWithFieldAction, shouldRotateAssistKeyOnError, type DFDFieldViewUI } from "./dfdFieldSources";

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
  /** Abre a importação expandida (processo iniciado por "Importar DFD existente"). */
  startWithImport?: boolean;
};

export default function DFDWorkspace({ processId = "", startWithImport = false }: DFDWorkspaceProps) {
  const utils = trpc.useUtils();
  const { enabled: ingestionEnabled } = useIngestionCapabilities();
  const { key: dfdKey, rotate: rotateDfdKey } = useIdempotencyKey();
  const { key: saveKey, rotate: rotateSaveKey } = useIdempotencyKey();
  const { key: reconcileKey, rotate: rotateReconcileKey } = useIdempotencyKey();
  const { key: aiKey, rotate: rotateAiKey } = useIdempotencyKey();
  const { key: acceptKey, rotate: rotateAcceptKey } = useIdempotencyKey();
  // SEM-058 — a sugestão de IA vive só na tela até um aceite humano explícito; descartar = zerar este estado.
  const [suggestion, setSuggestion] = useState<JustificationSuggestionUI | null>(null);
  const [acceptedEdited, setAcceptedEdited] = useState<boolean | null>(null);
  const [reconcilingKey, setReconcilingKey] = useState<string | null>(null);
  const [source, setSource] = useState<DFDSource>("pdf");
  const [draft, setDraft] = useState("");
  const [saveConflict, setSaveConflict] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const { data, isLoading } = trpc.procurementProcess.loadDFD.useQuery(
    { processId },
    { enabled: !!processId },
  );
  const doc = data?.document ?? null;
  // Contexto Canônico — estado por campo (read-only). Falha/indisponível ⇒ o DFD segue como antes.
  const { data: assist } = trpc.procurementProcess.dfdAssistState.useQuery(
    { processId },
    { enabled: !!processId && !!doc, retry: false },
  );

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
    utils.procurementProcess.dfdAssistState.invalidate({ processId });
    utils.procurementProcess.loadProcess.invalidate({ processId }); // reflete na Visão Geral
  };
  // Write explícito que altera o conteúdo no servidor: re-sincroniza o editor com o conteúdo persistido.
  const reloadEditor = () => { loadedFor.current = null; invalidate(); };

  const generateDFD = trpc.procurementProcess.generateDFD.useMutation({ onSuccess: () => { invalidate(); rotateDfdKey(); } });
  const saveDFD = trpc.procurementProcess.saveDFD.useMutation({
    onSuccess: () => { setSaveConflict(false); rotateSaveKey(); invalidate(); },
    onError: (e) => {
      // C.4B.3A (Blocker 5) — rotaciona a chave SOMENTE em CONFLICT (o estado revisado expirou); em
      // erro transitório (rede/INTERNAL) MANTÉM a chave para retry seguro/idempotente.
      if (shouldRotateSaveKeyOnError(e.data?.code)) rotateSaveKey();
      // Concorrência otimista: se o rascunho mudou desde o carregamento (CONFLICT), NÃO sobrescreve —
      // recarrega o conteúdo vigente e sinaliza para o usuário revisar de novo.
      if (e.data?.code === "CONFLICT") {
        setSaveConflict(true);
        loadedFor.current = null; // força re-sincronizar o editor com o conteúdo recarregado
        invalidate();
      }
    },
  });
  const importDFD = trpc.procurementProcess.importDFD.useMutation({ onSuccess: invalidate });
  const reconcileField = trpc.procurementProcess.reconcileDFDField.useMutation({
    onSuccess: () => { rotateReconcileKey(); reloadEditor(); },
    onError: (e) => { if (shouldRotateAssistKeyOnError(e.data?.code)) rotateReconcileKey(); if (e.data?.code === "CONFLICT") reloadEditor(); },
    onSettled: () => setReconcilingKey(null),
  });
  // SEM-058 — gerar NÃO altera o DFD: só traz a sugestão para comparar com o texto atual.
  const aiJustification = trpc.procurementProcess.generateDFDJustification.useMutation({
    onSuccess: (r) => { rotateAiKey(); setAcceptedEdited(null); setSuggestion(r as unknown as JustificationSuggestionUI); },
    onError: (e) => { if (shouldRotateAssistKeyOnError(e.data?.code)) rotateAiKey(); if (e.data?.code === "CONFLICT") reloadEditor(); },
  });
  // O único write do texto da IA: aceite humano explícito (consentimento literal + texto exibido).
  const acceptJustification = trpc.procurementProcess.acceptDFDJustification.useMutation({
    onSuccess: (r) => { rotateAcceptKey(); setSuggestion(null); setAcceptedEdited(r.edited); reloadEditor(); },
    onError: (e) => {
      if (shouldRotateAssistKeyOnError(e.data?.code)) rotateAcceptKey();
      if (e.data?.code === "CONFLICT") { setSuggestion(null); reloadEditor(); }
    },
  });

  const dirty = !!doc && draft !== doc.content;
  const assistFields = (assist?.available ? assist.fields : []) as DFDFieldViewUI[];

  const onFieldAction = (key: string) => {
    if (!processId || !doc) return;
    // Confirmação com valor atual × valor de origem; cancelar mantém o rascunho (nada é enviado).
    if (!shouldProceedWithFieldAction(assistFields.find((f) => f.key === key), (m) => window.confirm(m))) return;
    setReconcilingKey(key);
    reconcileField.mutate({ processId, fieldKey: key, expectedContentHash: doc.contentHash, idempotencyKey: reconcileKey });
  };

  const onGenerateJustification = () => {
    if (!processId || !doc) return;
    setSuggestion(null);
    setAcceptedEdited(null);
    aiJustification.mutate({ processId, expectedContentHash: doc.contentHash, idempotencyKey: aiKey });
  };

  const onAcceptJustification = (text: string) => {
    if (!processId || !doc || !suggestion) return;
    acceptJustification.mutate(buildAcceptInput({ processId, docContentHash: doc.contentHash, suggestion, text, idempotencyKey: acceptKey }));
  };

  // Descartar/fechar: nenhuma chamada, nenhum campo alterado — só esquece a sugestão em tela.
  const onDiscardSuggestion = () => { setSuggestion(null); aiJustification.reset(); acceptJustification.reset(); };

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
              onClick={() => processId && generateDFD.mutate({ processId, idempotencyKey: dfdKey })}
              disabled={!processId || generateDFD.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
            >
              {generateDFD.isPending ? "Criando..." : "Criar DFD do zero"}
            </button>
            {generateDFD.isError && (
              <p className="mt-2 text-sm text-destructive">
                {generateDFD.error?.message || "Falha ao criar o DFD."}
              </p>
            )}
          </div>

          {/* Importar DFD existente — P0 piloto: projeção documental REAL (PDF com texto/DOCX) no mesmo motor
              de ingestão → revisão → aprovação → rascunho do DFD. Com a flag DESLIGADA, o caminho legado
              permanece congelado. */}
          {ingestionEnabled ? (
            <DocumentImportPanel kind="dfd" processId={processId} defaultOpen={startWithImport} onPromoted={invalidate} />
          ) : (
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-1 font-medium text-foreground">{LEGACY_DFD_REGISTER_TITLE}</h2>
              <p className="mb-3 text-sm text-muted-foreground">{LEGACY_DFD_REGISTER_NOTE}</p>
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
                  className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
                >
                  {importDFD.isPending ? LEGACY_DFD_REGISTER_PENDING : LEGACY_DFD_REGISTER_BUTTON}
                </button>
              </div>
              {importDFD.isError && (
                <p className="mt-2 text-sm text-destructive">{LEGACY_DFD_REGISTER_ERROR}</p>
              )}
              {importDFD.isSuccess && (
                <p role="status" className="mt-2 text-sm text-muted-foreground">{legacyDfdRegisteredMessage(SOURCE_LABELS[source])}</p>
              )}
            </div>
          )}

          {!processId && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Selecione um processo para criar o DFD ou registrar a origem de um DFD existente.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Rascunho já existe: importar outro DFD exige substituição explícita (confirmação + motivo). */}
          {ingestionEnabled && processId && (
            <DocumentImportPanel kind="dfd" processId={processId} onPromoted={() => { loadedFor.current = null; invalidate(); }} />
          )}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Revisão obrigatória.</strong> Rascunho estruturado do DFD, pré-preenchido com as
            informações já conhecidas do processo. Revise, edite e salve. Textos sugeridos por IA são
            apenas sugestões: só entram no DFD se você aceitar, e nunca substituem a análise do servidor.
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
          {assistFields.length > 0 && (
            <DFDFieldSources fields={assistFields} dirty={dirty} busyKey={reconcilingKey} onAction={onFieldAction} />
          )}
          {assist?.available && (assist.unlinkedItemRows ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              {assist.unlinkedItemRows} linha(s) da tabela de itens deste DFD ainda não estão em “Itens da contratação”.
              Use “Preparar a partir do DFD” naquela aba para aproveitá-las.
            </p>
          )}
          {reconcileField.isError && reconcileField.error?.data?.code !== "CONFLICT" && (
            <p className="text-sm text-destructive">{reconcileField.error?.message || "Falha ao atualizar o campo."}</p>
          )}
          {saveConflict && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              O rascunho mudou desde o carregamento. O conteúdo foi recarregado — revise novamente antes de salvar.
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => processId && doc && saveDFD.mutate({ processId, content: draft, expectedContentHash: doc.contentHash, idempotencyKey: saveKey })}
              disabled={!processId || !draft.trim() || saveDFD.isPending}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
            >
              {saveDFD.isPending ? "Salvando..." : "Salvar rascunho"}
            </button>
            {assist?.available && (
              <button
                type="button"
                onClick={onGenerateJustification}
                disabled={!processId || dirty || aiJustification.isPending}
                title={dirty ? "Salve suas alterações antes de gerar a sugestão." : "A IA apenas sugere um texto para comparar com o atual; nada é alterado até você aceitar."}
                className="rounded-lg border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
              >
                {aiJustification.isPending ? "Gerando sugestão..." : "Sugerir justificativa (IA)"}
              </button>
            )}
            {saveDFD.isSuccess && !saveConflict && (
              <span className="text-sm text-green-600 dark:text-green-400">Rascunho salvo.</span>
            )}
            {saveDFD.isError && saveDFD.error?.data?.code !== "CONFLICT" && (
              <span className="text-sm text-destructive">
                {saveDFD.error?.message || "Falha ao salvar o rascunho."}
              </span>
            )}
          </div>
          {suggestion && !isSuggestionObsolete(suggestion, doc.contentHash) && (
            <DFDJustificationSuggestionPanel
              key={suggestion.explanation.executionId}
              suggestion={suggestion}
              docContentHash={doc.contentHash}
              dirty={dirty}
              pending={acceptJustification.isPending}
              errorMessage={acceptJustification.isError && acceptJustification.error?.data?.code !== "CONFLICT" ? acceptJustification.error?.message || "Falha ao registrar a justificativa." : null}
              onAccept={onAcceptJustification}
              onDiscard={onDiscardSuggestion}
            />
          )}
          {suggestion && isSuggestionObsolete(suggestion, doc.contentHash) && (
            <div role="status" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
              <p>O rascunho do DFD mudou depois que a sugestão foi gerada; ela não pode mais ser aceita. Gere uma nova sugestão para comparar com o texto atual.</p>
              <button type="button" onClick={onDiscardSuggestion} className="rounded-lg border border-input px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">Descartar sugestão</button>
            </div>
          )}
          {acceptedEdited !== null && !suggestion && (
            <p role="status" className="text-xs text-muted-foreground">{acceptedMessage(acceptedEdited)}</p>
          )}
          {acceptJustification.isError && acceptJustification.error?.data?.code === "CONFLICT" && !suggestion && (
            <p role="alert" className="text-sm text-destructive">{acceptJustification.error.message}</p>
          )}
          {aiJustification.isError && (
            <p className="text-sm text-destructive">{aiJustification.error?.message || "Falha ao gerar a sugestão da justificativa."}</p>
          )}
        </div>
      )}
    </div>
  );
}
