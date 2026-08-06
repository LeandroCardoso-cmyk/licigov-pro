/**
 * PR B.2.2 — Launcher institucional da ingestão supervisionada (composição reutilizável).
 *
 * Orquestra: gate por capability (flag + formatos reais) → entrada (manual / colar / arquivo) →
 * progresso persistido → revisão humana (staging) → aprovação da revisão. NÃO promove ao domínio.
 * Capability-aware: só oferece formatos com parser real (PDF/DOCX stub ⇒ indisponível).
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
import { useSupervisedIngestion, type IngestionImportType } from "@/hooks/ingestion/useSupervisedIngestion";
import { useStagingReview } from "@/hooks/ingestion/useStagingReview";
import { supportedFormatsLabel } from "@/lib/ingestion/capabilities";
import { PHASE_META, INSTITUTIONAL_COPY, type IngestionPhase } from "@/lib/ingestion/status";
import type { StagingItem } from "@/lib/ingestion/staging";

import { FileDropzone } from "./FileDropzone";
import { IngestionSessionProgress } from "./IngestionSessionProgress";
import { IngestionWarningsPanel } from "./IngestionWarningsPanel";
import { IngestionErrorState } from "./IngestionErrorState";
import { IngestionAuditSummary } from "./IngestionAuditSummary";
import { StagingReviewTable } from "./StagingReviewTable";
import { StagingReviewDrawer } from "./StagingReviewDrawer";

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
}: DocumentIngestionLauncherProps) {
  const { capabilities: rawCaps, enabled, isLoading } = useIngestionCapabilities();

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

  const [pasteText, setPasteText] = useState("");
  const [detailItem, setDetailItem] = useState<StagingItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const hasSupportedFormats = (capabilities?.supportedFormats.length ?? 0) > 0;
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

  // Capability-aware: habilitado, porém sem formato real disponível (ex.: DFD/ETP dependem de
  // PDF/DOCX, ainda stub) → não expõe funcionalidade incompleta; informa objetivamente.
  if (!hasSupportedFormats) {
    return (
      <Alert>
        <Info className="size-4" aria-hidden="true" />
        <AlertTitle>Importação por arquivo indisponível nesta etapa</AlertTitle>
        <AlertDescription>
          Os formatos necessários (PDF/DOCX) ainda não têm extração disponível. A importação assistida
          será habilitada em etapa posterior (B.2.3). As demais ações deste documento seguem disponíveis.
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
        {/* Entrada: manual / colar / arquivo */}
        {showEntry && (
          <Tabs defaultValue={manualSlot ? "manual" : "file"}>
            <TabsList>
              {manualSlot && <TabsTrigger value="manual">Inserir manualmente</TabsTrigger>}
              {allowPaste && <TabsTrigger value="paste">Colar conteúdo</TabsTrigger>}
              <TabsTrigger value="file">Enviar arquivo</TabsTrigger>
            </TabsList>

            {manualSlot && <TabsContent value="manual" className="pt-3">{manualSlot}</TabsContent>}

            {allowPaste && (
              <TabsContent value="paste" className="space-y-2 pt-3">
                <Textarea
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="Cole aqui o conteúdo tabular (linhas separadas por quebra de linha; colunas por vírgula/tabulação)…"
                  rows={6}
                  aria-label="Conteúdo a colar"
                />
                <Button
                  disabled={ingestion.isBusy || pasteText.trim().length === 0}
                  onClick={() => ingestion.start({ kind: "text", text: pasteText })}
                >
                  Processar conteúdo colado
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
        {ingestion.phase === "failed" && !ingestion.clientError && (
          <IngestionErrorState
            message={PHASE_META.failed.description}
            onRetry={ingestion.retry}
            retrying={ingestion.isBusy}
          />
        )}

        <IngestionWarningsPanel warnings={sessionWarnings} />

        {/* Revisão humana */}
        {inReview && (
          <div className="space-y-3">
            <IngestionAuditSummary summary={summary} sessionId={ingestion.sessionId} procurementProcessId={procurementProcessId} />
            <StagingReviewTable
              items={review.items as unknown as StagingItem[]}
              disabled={review.isReviewing || ingestion.phase === "approved"}
              onReview={(id, action, note) => review.reviewItem(id, action, note)}
              onReviewBulk={(ids, action) => review.reviewBulk(ids, action)}
              onOpenDetail={openDetail}
            />

            {ingestion.phase === "approved" ? (
              <Alert className="border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
                <AlertTitle>{PHASE_META.approved.label}</AlertTitle>
                <AlertDescription>{INSTITUTIONAL_COPY.notOfficialYet}</AlertDescription>
              </Alert>
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
                {review.approveError && <p className="text-sm text-destructive">{review.approveError.message}</p>}
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
