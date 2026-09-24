/**
 * PR B.2.2 — Launcher institucional da ingestão supervisionada (composição reutilizável).
 *
 * Orquestra: gate por capability (flag + formatos reais) → entrada (arquivo / colar texto [/ manual]) →
 * progresso persistido → revisão humana (staging) → aprovação da revisão → promoção supervisionada.
 * Capability-aware: só oferece formatos com parser real (derivado do parserRegistry no backend).
 * DFD/ETP/TR como DOCUMENTO usam o DocumentImportPanel (mesmo motor, projeção documental).
 */
import { useMemo, useState, type ReactNode } from "react";
import { FileText, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

import { useIngestionCapabilities } from "@/hooks/ingestion/useIngestionCapabilities";
import { useOrgRole } from "@/_core/hooks/useOrgRole";
import { useSupervisedIngestion, type IngestionImportType } from "@/hooks/ingestion/useSupervisedIngestion";
import { useStagingReview } from "@/hooks/ingestion/useStagingReview";
import { usePriceResearchReview } from "@/hooks/ingestion/usePriceResearchReview";
import { supportedFormatsLabel } from "@/lib/ingestion/capabilities";
import { PHASE_META, INSTITUTIONAL_COPY, type IngestionPhase } from "@/lib/ingestion/status";
import { describeOutcome } from "@/lib/ingestion/outcome";
import type { StagingItem } from "@/lib/ingestion/staging";

import { FileDropzone } from "./FileDropzone";
import { IngestionSessionProgress } from "./IngestionSessionProgress";
import { IngestionWarningsPanel } from "./IngestionWarningsPanel";
import { IngestionErrorState } from "./IngestionErrorState";
import { IngestionAuditSummary } from "./IngestionAuditSummary";
import { StagingReviewTable } from "./StagingReviewTable";
import { StagingReviewDrawer } from "./StagingReviewDrawer";
import { PromoteToDomainPanel } from "./PromoteToDomainPanel";
import { PriceResearchReviewList, PriceResearchReviewSummary } from "./PriceResearchReviewList";
import { ExtractionActionsPanel, ExtractionObservationsPanel } from "./ExtractionDetailsPanels";

const REVIEW_PHASES: IngestionPhase[] = ["awaiting_review", "partially_reviewed", "reviewed", "approved"];

interface DocumentIngestionLauncherProps {
  importType: IngestionImportType;
  /** Processo CANÔNICO (id string) do workspace atual. A ingestão só é exposta com processo válido. */
  procurementProcessId?: string;
  importPurpose?: string;
  title?: string;
  description?: string;
  /** Formulário de entrada MANUAL do domínio (fica fora da ingestão canônica). */
  manualSlot?: ReactNode;
  /** Permite ocultar a aba "colar conteúdo" quando não fizer sentido para o domínio. */
  allowPaste?: boolean;
  /**
   * Restringe a capacidade aos formatos RELEVANTES para este documento (ex.: DFD/ETP só fazem
   * sentido a partir de PDF/DOCX). Se nenhum formato relevante for `supported` (parser real), a
   * importação é apresentada como indisponível — sem ofertar formatos alheios ao documento.
   */
  relevantFormatKeys?: string[];
  onApproved?: (sessionId: number) => void;
  /** P0 piloto — CTA pós-promoção da Pesquisa: abrir os Itens Inteligentes. */
  onReviewItems?: () => void;
}

export function DocumentIngestionLauncher({
  importType,
  procurementProcessId,
  importPurpose,
  title = "Importar por arquivo",
  description,
  manualSlot,
  allowPaste = true,
  relevantFormatKeys,
  onApproved,
  onReviewItems,
}: DocumentIngestionLauncherProps) {
  const { capabilities: rawCaps, enabled, isLoading } = useIngestionCapabilities();
  const { hasRole, isLoading: roleLoading } = useOrgRole();

  // Capacidade escopada aos formatos relevantes do documento (quando informado).
  const capabilities = useMemo(() => {
    if (!rawCaps) return undefined;
    if (!relevantFormatKeys) return rawCaps;
    const formats = rawCaps.formats.filter((f) => relevantFormatKeys.includes(f.key));
    return { ...rawCaps, formats, supportedFormats: formats.filter((f) => f.supported) };
  }, [rawCaps, relevantFormatKeys]);
  const ingestion = useSupervisedIngestion({
    importType,
    procurementProcessId: procurementProcessId ?? "",
    importPurpose,
    onApproachReview: () => {},
  });
  const inReview = REVIEW_PHASES.includes(ingestion.phase);
  const review = useStagingReview(ingestion.sessionId, inReview, procurementProcessId ?? "");
  // Pesquisa de Preços: revisão ITEM-CÊNTRICA (itens lógicos com cotações subordinadas).
  const itemCentric = importType === "price_research";
  const priceReview = usePriceResearchReview(ingestion.sessionId, inReview && itemCentric, procurementProcessId ?? "");

  const [pasteText, setPasteText] = useState("");
  const [detailItem, setDetailItem] = useState<StagingItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const hasSupportedFormats = (capabilities?.supportedFormats.length ?? 0) > 0;
  const outcome = describeOutcome(ingestion.session as Parameters<typeof describeOutcome>[0]);
  const sessionWarnings = useMemo(
    () => (Array.isArray(ingestion.session?.warnings) ? (ingestion.session!.warnings as { code?: string; message?: string }[]) : []),
    [ingestion.session],
  );

  // Gate: sem flag → interface não exposta (o backend também nega cada operação).
  if (isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" /> Carregando…</div>;
  }
  if (!enabled || !capabilities) return null;

  // Sem processo canônico selecionado, a ingestão não é exposta (vínculo é obrigatório).
  if (!procurementProcessId) {
    return (
      <Alert>
        <Info className="size-4" aria-hidden="true" />
        <AlertTitle>Selecione um processo</AlertTitle>
        <AlertDescription>A importação por arquivo fica disponível dentro de um processo licitatório.</AlertDescription>
      </Alert>
    );
  }

  // Capability-aware: habilitado, porém sem formato real disponível → não expõe funcionalidade
  // incompleta; informa objetivamente (a capacidade vem do parserRegistry, não de texto fixo).
  if (!hasSupportedFormats) {
    return (
      <Alert>
        <Info className="size-4" aria-hidden="true" />
        <AlertTitle>Importação por arquivo indisponível</AlertTitle>
        <AlertDescription>
          Nenhum formato de arquivo com extração disponível para este documento no momento. As demais
          ações deste documento seguem disponíveis.
        </AlertDescription>
      </Alert>
    );
  }

  function openDetail(item: StagingItem) { setDetailItem(item); setDrawerOpen(true); }

  const summary = ingestion.staging as
    | { total: number; pending: number; approved: number; rejected: number; skipped: number }
    | null;
  const showEntry = ingestion.phase === "idle";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="size-4" aria-hidden="true" /> {title}</CardTitle>
        <CardDescription>{description ?? `Formatos suportados: ${supportedFormatsLabel(capabilities)}.`}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Entrada: arquivo (padrão) / colar texto (mesmo caminho canônico) / manual (só se o domínio fornecer) */}
        {showEntry && (
          <Tabs defaultValue="file">
            <TabsList>
              <TabsTrigger value="file">Enviar arquivo</TabsTrigger>
              {allowPaste && <TabsTrigger value="paste">Colar texto</TabsTrigger>}
              {manualSlot && <TabsTrigger value="manual">Importar texto direto</TabsTrigger>}
            </TabsList>

            {manualSlot && <TabsContent value="manual" className="pt-3">{manualSlot}</TabsContent>}

            {allowPaste && (
              <TabsContent value="paste" className="space-y-2 pt-3">
                <Textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Cole aqui a tabela de cotações: uma linha por item, colunas separadas por tabulação, ponto e vírgula ou vírgula…"
                  rows={6}
                  aria-label="Texto a colar"
                />
                <p className="text-xs text-muted-foreground">
                  O texto colado segue o mesmo caminho do arquivo: extração, revisão item a item e só então a promoção.
                </p>
                <Button
                  disabled={ingestion.isBusy || pasteText.trim().length === 0}
                  onClick={() => ingestion.start({ kind: "text", text: pasteText })}
                >
                  Processar texto colado
                </Button>
              </TabsContent>
            )}

            <TabsContent value="file" className="pt-3">
              <FileDropzone
                capabilities={capabilities}
                disabled={ingestion.isBusy}
                onFileAccepted={(file) => ingestion.start({ kind: "file", file })}
              />
            </TabsContent>
          </Tabs>
        )}

        {/* Progresso persistido */}
        {ingestion.phase !== "idle" && (
          <IngestionSessionProgress phase={ingestion.phase} progress={ingestion.session?.progress ?? null} />
        )}

        {(ingestion.phase === "preparing" || ingestion.phase === "uploading") && (
          <Button variant="ghost" size="sm" onClick={ingestion.cancel}>Cancelar envio</Button>
        )}

        {/* Erro acionável */}
        {ingestion.clientError && (
          <IngestionErrorState
            message={ingestion.clientError}
            correlationId={ingestion.session?.correlationId ?? null}
            onRetry={ingestion.sessionId ? ingestion.retry : undefined}
            retrying={ingestion.isBusy}
          />
        )}
        {/* U2A — desfecho explícito (OCR em andamento / OCR indisponível / falha / nenhum item) */}
        {outcome.kind === "ocr_processing" && (
          <Alert>
            <Info className="size-4" aria-hidden="true" />
            <AlertTitle>{outcome.title}</AlertTitle>
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        )}
        {(ingestion.phase === "failed" || ingestion.phase === "dlq") && !ingestion.clientError && (
          outcome.kind !== "none" && outcome.kind !== "ocr_processing" && outcome.kind !== "review_required_ocr" ? (
            <IngestionErrorState
              title={outcome.title}
              message={outcome.message}
              correlationId={ingestion.session?.correlationId ?? null}
              onRetry={outcome.canRetry ? ingestion.retry : undefined}
              retrying={ingestion.isBusy}
              onNewFile={outcome.suggestNewFile ? ingestion.reset : undefined}
            />
          ) : ingestion.phase === "failed" ? (
            <IngestionErrorState
              message={PHASE_META.failed.description}
              onRetry={ingestion.retry}
              retrying={ingestion.isBusy}
            />
          ) : null
        )}
        {outcome.kind === "review_required_ocr" && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <Info className="size-4" aria-hidden="true" />
            <AlertTitle>{outcome.title}</AlertTitle>
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        )}

        {itemCentric ? <ExtractionObservationsPanel warnings={sessionWarnings} /> : <IngestionWarningsPanel warnings={sessionWarnings} />}

        {/* Revisão humana */}
        {inReview && (
          <div className="space-y-3">
            {itemCentric && ingestion.reprocessState?.inProgress && (
              <ExtractionActionsPanel
                reprocess={ingestion.reprocessState}
                isReprocessing={ingestion.isReprocessing}
                error={ingestion.reprocessError}
                onReprocess={ingestion.reprocess}
              />
            )}
            {itemCentric ? (
              priceReview.review ? (
                <>
                  <PriceResearchReviewSummary counts={priceReview.review.counts} sessionId={ingestion.sessionId} procurementProcessId={procurementProcessId} />
                  <PriceResearchReviewList
                    review={priceReview.review}
                    disabled={review.isReviewing || ingestion.phase === "approved" || !!ingestion.reprocessState?.inProgress}
                    isDeciding={priceReview.isDeciding}
                    decisionError={priceReview.decisionError}
                    onDecideGroups={(action, groups) => priceReview.decideGroups(action, groups)}
                    onReviewQuote={(id, action) => review.reviewItem(id, action)}
                    onOpenQuote={(q) => { if (q.stagingItem) openDetail(q.stagingItem as unknown as StagingItem); }}
                  />
                </>
              ) : priceReview.error ? (
                <IngestionErrorState message={priceReview.error.message} onRetry={priceReview.refresh} />
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="size-4" /> Carregando itens…</div>
              )
            ) : (
              <>
                <IngestionAuditSummary summary={summary} sessionId={ingestion.sessionId} procurementProcessId={procurementProcessId} />
                {ingestion.phase !== "approved" && (
                  <ExtractionActionsPanel
                    reprocess={ingestion.reprocessState}
                    isReprocessing={ingestion.isReprocessing}
                    error={ingestion.reprocessError}
                    onReprocess={ingestion.reprocess}
                  />
                )}
                <StagingReviewTable
                  items={review.items as unknown as StagingItem[]}
                  disabled={review.isReviewing || ingestion.phase === "approved" || !!ingestion.reprocessState?.inProgress}
                  onReview={(id, action, note) => review.reviewItem(id, action, note)}
                  onReviewBulk={(ids, action) => review.reviewBulk(ids, action)}
                  onOpenDetail={openDetail}
                />
              </>
            )}

            {ingestion.phase === "approved" ? (
              <div className="space-y-3">
                <Alert className="border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
                  <AlertTitle>{PHASE_META.approved.label}</AlertTitle>
                  <AlertDescription>{INSTITUTIONAL_COPY.notOfficialYet}</AlertDescription>
                </Alert>
                <PromoteToDomainPanel
                  status={ingestion.promotionStatus}
                  importType={importType}
                  canPromote={ingestion.canPromote && !roleLoading && hasRole("manager")}
                  requiresManager={ingestion.canPromote && !roleLoading && !hasRole("manager")}
                  isPromoting={ingestion.isPromoting}
                  error={ingestion.promoteError}
                  result={ingestion.promotionResult}
                  onPromote={ingestion.promote}
                  onReviewItems={onReviewItems}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{INSTITUTIONAL_COPY.notOfficialYet}</p>
                <Button
                  disabled={review.isApproving || (summary?.pending ?? 1) > 0}
                  onClick={async () => {
                    const res = await review.approveSession();
                    if (res && ingestion.sessionId) onApproved?.(ingestion.sessionId);
                  }}
                >
                  {review.isApproving ? "Aprovando revisão…" : INSTITUTIONAL_COPY.reviewApproval}
                </Button>
                {itemCentric && priceReview.review && priceReview.review.counts.quoteStatus.pending > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Para aprovar a revisão, decida todos os itens: {priceReview.review.counts.items.pending + priceReview.review.counts.items.partially_reviewed} item(ns)
                    com {priceReview.review.counts.quoteStatus.pending} cotação(ões) pendente(s).
                  </p>
                )}
                {review.approveError && <p className="text-sm text-destructive">{review.approveError.message}</p>}
                {/* Ação técnica secundária: não compete com a revisão normal. */}
                {itemCentric && !ingestion.reprocessState?.inProgress && (
                  <ExtractionActionsPanel
                    reprocess={ingestion.reprocessState}
                    isReprocessing={ingestion.isReprocessing}
                    error={ingestion.reprocessError}
                    onReprocess={ingestion.reprocess}
                  />
                )}
              </div>
            )}
          </div>
        )}

        <StagingReviewDrawer
          item={detailItem}
          open={drawerOpen}
          disabled={review.isReviewing || ingestion.phase === "approved"}
          importType={importType}
          isCorrecting={review.isCorrecting}
          correctError={review.correctError}
          onOpenChange={setDrawerOpen}
          onReview={(id, action, note) => review.reviewItem(id, action, note)}
          onCorrect={(id, rev, patch, justification, key) => review.correctItem(id, rev, patch, justification, key)}
        />
      </CardContent>
    </Card>
  );
}
