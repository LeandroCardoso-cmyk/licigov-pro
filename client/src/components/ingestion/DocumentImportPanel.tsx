/**
 * P0 piloto — Importação DOCUMENTAL de DFD / ETP / TR ("a Secretaria mandou os documentos").
 *
 * Mesmo motor da ingestão (sessão, upload multipart, fila, parser real PDF/DOCX) — sem pipeline paralelo.
 * Passos visíveis: 1) enviar arquivo → 2) revisar o texto extraído (edição humana; original preservado)
 * → 3) aprovar o conteúdo revisado → 4) promover a RASCUNHO do processo (ou substituir o rascunho atual,
 * com confirmação + motivo). Nada é oficial: a emissão continua exigindo revisão de terceiro (SoD).
 * Sem IA na importação. PDF digitalizado (só imagem) é recusado com orientação (sem OCR nesta versão).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Info, CheckCircle2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useIngestionCapabilities } from "@/hooks/ingestion/useIngestionCapabilities";
import { useSupervisedIngestion } from "@/hooks/ingestion/useSupervisedIngestion";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import { documentImportCapabilities, documentImportStep, DOCUMENT_KIND_LABEL, type DocumentKind } from "@/lib/ingestion/documentImport";
import { FileDropzone } from "./FileDropzone";

interface DocumentImportPanelProps {
  kind: DocumentKind;
  processId: string;
  /** Abre expandido (ex.: processo iniciado por "Importar TR existente"). */
  defaultOpen?: boolean;
  /** Chamado após promover/substituir o rascunho (o workspace recarrega o rascunho canônico). */
  onPromoted?: () => void;
}

const STEP_LABELS = ["Enviar arquivo", "Revisar texto extraído", "Aprovar conteúdo", "Promover a rascunho"];

export function DocumentImportPanel({ kind, processId, defaultOpen = false, onPromoted }: DocumentImportPanelProps) {
  const label = DOCUMENT_KIND_LABEL[kind];
  const { capabilities: rawCaps, enabled, isLoading } = useIngestionCapabilities();
  const capabilities = useMemo(() => documentImportCapabilities(rawCaps), [rawCaps]);
  const [open, setOpen] = useState(defaultOpen);
  const utils = trpc.useUtils();

  const ingestion = useSupervisedIngestion({ importType: `document_${kind}`, procurementProcessId: processId, importPurpose: `${kind}_import` });
  const sessionStatus = (ingestion.session?.status as string | undefined) ?? null;

  const intake = trpc.ingestion.getDocumentIntake.useQuery(
    { procurementProcessId: processId, kind },
    { enabled: enabled && !!processId, refetchOnWindowFocus: false },
  );
  // Quando o worker conclui (awaiting_review), recarrega a projeção extraída.
  useEffect(() => {
    if (sessionStatus === "awaiting_review") void intake.refetch();
  }, [sessionStatus]);

  const staging = intake.data?.staging ?? null;
  const draft = intake.data?.draft ?? { exists: false, contentHash: null, origin: null, title: null };
  const [text, setText] = useState("");
  const syncedRev = useRef<string | null>(null);
  useEffect(() => {
    const key = staging ? `${staging.id}:${staging.revision}` : null;
    if (staging && syncedRev.current !== key) { setText(staging.content); syncedRev.current = key; }
    if (!staging) syncedRev.current = null;
  }, [staging]);

  const invalidate = () => { void intake.refetch(); };
  const saveReview = trpc.ingestion.saveDocumentReview.useMutation({ onSuccess: invalidate, onError: invalidate });
  const approve = trpc.ingestion.approveDocument.useMutation({ onSuccess: invalidate, onError: invalidate });
  const reject = trpc.ingestion.rejectDocument.useMutation({ onSuccess: () => { ingestion.reset(); invalidate(); } });
  const { key: promoteKey, rotate: rotatePromoteKey } = useIdempotencyKey();
  const promote = trpc.ingestion.promoteDocument.useMutation({
    onSuccess: () => {
      rotatePromoteKey();
      invalidate();
      utils.procurementProcess.reviewableDraft.invalidate({ processId });
      utils.procurementProcess.loadDFD.invalidate({ processId });
      utils.procurementProcess.loadProcess.invalidate({ processId });
      onPromoted?.();
    },
    onError: (e) => { if (e.data?.code === "CONFLICT") rotatePromoteKey(); invalidate(); },
  });
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [replaceReason, setReplaceReason] = useState("");

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" /> Carregando…</div>;
  if (!enabled || !capabilities || !processId) return null;

  const step = documentImportStep({ sessionStatus, stagingStatus: staging?.status ?? null, busy: ingestion.isBusy });
  const dirty = !!staging && text !== staging.content;
  const failedErrors = (ingestion.session?.errors ?? []) as Array<{ code?: string; message?: string }>;
  const sessionFailed = sessionStatus === "failed";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2"><FileText className="size-4" aria-hidden="true" /> Importar {label} existente</span>
          {!open && <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Importar {label}</Button>}
        </CardTitle>
        <CardDescription>
          Traga o {label} que a Secretaria já elaborou (PDF com texto ou DOCX). O texto é extraído sem IA, você
          revisa e aprova, e ele vira o rascunho deste processo — o mesmo usado pelas próximas etapas.
          PDF escaneado exige OCR, ainda indisponível. O formato antigo .doc não é suportado.
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <ol className="flex flex-wrap gap-2 text-xs" aria-label="Etapas da importação">
            {STEP_LABELS.map((s, i) => (
              <li key={s} className={`rounded-full px-2.5 py-1 ${i + 1 === step ? "bg-primary text-primary-foreground" : i + 1 < step ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {i + 1}. {s}
              </li>
            ))}
          </ol>

          {/* 1) Envio */}
          {(!staging || staging.status === "rejected" || staging.status === "promoted") && !ingestion.isBusy && sessionStatus !== "queued" && sessionStatus !== "parsing" && (
            <FileDropzone capabilities={capabilities} disabled={ingestion.isBusy} onFileAccepted={(file) => ingestion.start({ kind: "file", file })} />
          )}
          {(ingestion.isBusy || sessionStatus === "queued" || sessionStatus === "parsing" || sessionStatus === "uploaded") && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" /> Extraindo o texto do documento…</div>
          )}
          {ingestion.clientError && <p className="text-sm text-destructive" role="alert">{ingestion.clientError}</p>}
          {sessionFailed && (
            <Alert variant="destructive">
              <Info className="size-4" aria-hidden="true" />
              <AlertTitle>{failedErrors.some((e) => e.code === "OCR_REQUIRED") ? "Documento digitalizado (somente imagem)" : "Não foi possível extrair o texto"}</AlertTitle>
              <AlertDescription>
                {failedErrors[0]?.message ?? "Falha ao processar o arquivo."}
                <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => ingestion.reset()}>Enviar outro arquivo</Button></div>
              </AlertDescription>
            </Alert>
          )}

          {/* 2–3) Revisão + aprovação */}
          {staging && (staging.status === "pending_review" || staging.status === "approved") && (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Arquivo: <strong className="text-foreground">{staging.originalFileName}</strong> · {staging.stats.blocks} bloco(s)
                {staging.stats.pages ? ` · ${staging.stats.pages} página(s)` : ""}{staging.stats.tables ? ` · ${staging.stats.tables} tabela(s)` : ""}
                {staging.edited ? " · revisado (o texto original extraído permanece preservado)" : ""}
              </div>
              {staging.warnings.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-700 dark:text-amber-300">
                  {staging.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
                </ul>
              )}
              <label className="flex flex-col text-sm">
                <span className="mb-1 font-medium text-foreground">Texto extraído (revise e corrija antes de aprovar)</span>
                <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} className="font-mono text-xs" aria-label={`Conteúdo do ${label} importado`} />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary" disabled={!dirty || saveReview.isPending || !text.trim()}
                  onClick={() => saveReview.mutate({ procurementProcessId: processId, stagingId: staging.id, expectedRevision: staging.revision, content: text })}
                >
                  {saveReview.isPending ? "Salvando revisão…" : "Salvar revisão"}
                </Button>
                {staging.status === "pending_review" ? (
                  <Button
                    disabled={dirty || approve.isPending}
                    onClick={() => approve.mutate({ procurementProcessId: processId, stagingId: staging.id, expectedContentHash: staging.contentHash })}
                    title={dirty ? "Salve a revisão antes de aprovar" : undefined}
                  >
                    {approve.isPending ? "Aprovando…" : "Aprovar conteúdo revisado"}
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-sm text-green-700 dark:text-green-400"><CheckCircle2 className="size-4" /> Conteúdo aprovado</span>
                )}
                <Button variant="ghost" size="sm" disabled={reject.isPending} onClick={() => reject.mutate({ procurementProcessId: processId, stagingId: staging.id })}>
                  Descartar importação
                </Button>
              </div>
              {saveReview.error && <p className="text-sm text-destructive" role="alert">{saveReview.error.message}</p>}
              {approve.error && <p className="text-sm text-destructive" role="alert">{approve.error.message}</p>}

              {/* Sugestão de itens (TR): tabelas encontradas — nunca aplicadas automaticamente. */}
              {kind === "tr" && staging.itemSuggestions.length > 0 && (
                <div className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium text-foreground">Itens encontrados nas tabelas do TR (sugestão)</p>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Não são aplicados automaticamente. Para usar como estimativa, importe-os pela Pesquisa de Preços e aprove os Itens Inteligentes.
                  </p>
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs text-foreground">
                    {staging.itemSuggestions.slice(0, 50).map((it) => (
                      <li key={`${it.tableIndex}-${it.row}`}>• {it.description}{it.quantity ? ` — ${it.quantity}` : ""}{it.unit ? ` ${it.unit}` : ""}{it.unitPrice ? ` · ${it.unitPrice}` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 4) Promoção a rascunho */}
              {staging.status === "approved" && (
                <div className="space-y-2 rounded-md border border-border p-3">
                  {!draft.exists ? (
                    <>
                      <p className="text-sm text-foreground">O conteúdo aprovado vira o <strong>rascunho do {label}</strong> deste processo (não é documento oficial).</p>
                      <Button
                        disabled={promote.isPending}
                        onClick={() => promote.mutate({ procurementProcessId: processId, stagingId: staging.id, mode: "create", idempotencyKey: promoteKey })}
                      >
                        {promote.isPending ? "Promovendo…" : `Usar como rascunho do ${label}`}
                      </Button>
                    </>
                  ) : !confirmReplace ? (
                    <>
                      <p className="text-sm text-amber-700 dark:text-amber-300">
                        Já existe um rascunho de {label} neste processo{draft.origin === "import" ? " (importado anteriormente)" : ""}. Ele NÃO será alterado sem sua confirmação.
                      </p>
                      <Button variant="secondary" onClick={() => setConfirmReplace(true)}>Substituir rascunho…</Button>
                    </>
                  ) : (
                    <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                      <p className="text-sm font-medium">Confirmar substituição do rascunho de {label}</p>
                      <p className="text-xs">O rascunho atual fica preservado no histórico de edições. Documentos já emitidos não são alterados.</p>
                      <Textarea value={replaceReason} onChange={(e) => setReplaceReason(e.target.value)} rows={2} placeholder="Motivo da substituição (obrigatório)" aria-label="Motivo da substituição" />
                      <div className="flex gap-2">
                        <Button
                          size="sm" disabled={promote.isPending || replaceReason.trim().length < 5 || !draft.contentHash}
                          onClick={() => promote.mutate({
                            procurementProcessId: processId, stagingId: staging.id, mode: "replace",
                            expectedDraftContentHash: draft.contentHash ?? undefined, reason: replaceReason.trim(), idempotencyKey: promoteKey,
                          })}
                        >
                          {promote.isPending ? "Substituindo…" : "Confirmar substituição"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmReplace(false)}>Cancelar</Button>
                      </div>
                    </div>
                  )}
                  {promote.error && <p className="text-sm text-destructive" role="alert">{promote.error.message}</p>}
                </div>
              )}
            </div>
          )}

          {staging?.status === "promoted" && (
            <Alert className="border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
              <CheckCircle2 className="size-4" aria-hidden="true" />
              <AlertTitle>{label} importado é o rascunho do processo</AlertTitle>
              <AlertDescription>
                {staging.promotionMode === "replace" ? "O rascunho anterior foi substituído (preservado no histórico). " : ""}
                Revise e edite abaixo; a emissão oficial exige revisão de um terceiro. Você pode importar outro arquivo se necessário.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      )}
    </Card>
  );
}
