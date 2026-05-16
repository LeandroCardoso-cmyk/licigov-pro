import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  FileText,
  Download,
  AlertCircle,
  Scale,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { PageLoader, InlineLoader } from "@/components/ui/PageLoader";
import { formatDateTime, formatCurrency } from "@/utils/formatters";
import { triggerBlobDownload, base64ToBlob } from "@/services/download";
import { useLocation, useParams } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { APP_LOGO } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { toast } from "sonner";
import { MembersDialog } from "@/components/MembersDialog";
import { NotificationBell } from "@/components/NotificationBell";
import { TRItemsModal } from "@/components/TRItemsModal";
import { PublicationPackageModal } from "@/components/process/PublicationPackageModal";
import { cn } from "@/lib/utils";
import { DOC_LABELS, DOC_ORDER, PREREQUISITES, STATUS_LABELS } from "@/components/document-flow/types";
import type { DocType } from "@/components/document-flow/types";
import { StepBadge } from "@/components/document-flow/StepBadge";
import { TimelineStep } from "@/components/document-flow/TimelineStep";
import { DocTabContent } from "@/components/document-flow/DocTabContent";
import { useProcessDocuments } from "@/hooks/documents/useProcessDocuments";

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProcessDetails() {
  const { user, logout } = useAuth();
  const [publicationModalOpen, setPublicationModalOpen] = useState(false);
  const [exportingReport, setExportingReport] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const [, navigate] = useLocation();
  const exportReportMutation = trpc.downloads.processReport.useMutation();
  const params = useParams();
  const processId = parseInt(params.id || "0");
  const [trItemsModalOpen, setTrItemsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DocType>("dfd");

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: process, isLoading: processLoading } = trpc.processes.getById.useQuery({ id: processId });
  const { data: documents, isLoading: documentsLoading } = trpc.documents.listByProcess.useQuery({ processId });
  const { data: activities } = trpc.activities.listByProcess.useQuery({ processId });
  const utils = trpc.useUtils();

  const invalidate = () => {
    utils.processes.getById.invalidate({ id: processId });
    utils.documents.listByProcess.invalidate({ processId });
    utils.activities.listByProcess.invalidate({ processId });
  };

  // ── Document actions hook ─────────────────────────────────────────────────────

  const docActions = useProcessDocuments({ processId, invalidate, setActiveTab });

  // ── Report export ─────────────────────────────────────────────────────────────

  const handleExportReport = async () => {
    setExportingReport(true);
    try {
      const result = await exportReportMutation.mutateAsync({ processId });
      const blob = base64ToBlob(result.data, result.mimeType);
      triggerBlobDownload(blob, result.filename);
      toast.success("Relatório exportado!");
    } catch {
      toast.error("Falha ao exportar relatório.");
    } finally {
      setExportingReport(false);
    }
  };

  // ── Loading / error states ────────────────────────────────────────────────────

  if (processLoading || documentsLoading) {
    return <div className="min-h-screen bg-background"><PageLoader /></div>;
  }

  if (!process) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <h2 className="text-2xl font-bold">Processo não encontrado</h2>
        <Button onClick={() => navigate("/dashboard")}>Voltar ao Dashboard</Button>
      </div>
    );
  }

  // ── Derived state ─────────────────────────────────────────────────────────────

  const docs = documents ?? [];
  const docMap = {
    dfd: docs.find((d) => d.type === "dfd"),
    etp: docs.find((d) => d.type === "etp"),
    tr: docs.find((d) => d.type === "tr"),
    edital: docs.find((d) => d.type === "edital"),
  } as Record<DocType, (typeof docs)[number] | undefined>;

  const getStepStatus = (docType: DocType) => {
    if (docActions.generatingDoc === docType) return "generating" as const;
    if (docActions.uploadingDoc === docType) return "uploading" as const;
    const doc = docMap[docType];
    if (doc) return doc.sourceType === "upload" ? "done-upload" as const : "done-ai" as const;
    const prereq = PREREQUISITES[docType];
    if (prereq && !docMap[prereq]) return "locked" as const;
    return "pending" as const;
  };

  const stepStatuses = Object.fromEntries(DOC_ORDER.map((d) => [d, getStepStatus(d)])) as Record<DocType, ReturnType<typeof getStepStatus>>;

  const documentActions = {
    ...docActions,
    onGenerate: docActions.handleGenerate,
    onUploadClick: docActions.handleUploadClick,
    onDownloadPdf: docActions.handleDownloadPdf,
    onDownloadDocx: docActions.handleDownloadDocx,
    onDownloadUpload: docActions.handleDownloadUpload,
    onEdit: docActions.handleStartEdit,
    onSaveEdit: docActions.handleSaveEdit,
    onCancelEdit: docActions.handleCancelEdit,
    onAutoSave: docActions.handleAutoSave,
    onTabChange: setActiveTab,
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6">
          <div className="flex h-20 items-center justify-between">
            <div className="flex items-center gap-6">
              <img src={APP_LOGO} alt="LiciGov Pro" className="h-20 w-auto" />
              <Button variant="ghost" size="icon" onClick={toggleTheme}>
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <div className="text-right">
                <p className="text-sm font-medium">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <Button variant="outline" size="sm" onClick={logout}>Sair</Button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Main ── */}
      <main className="container mx-auto px-6 py-8 max-w-6xl">
        <Button variant="ghost" className="mb-6 -ml-4" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar ao Dashboard
        </Button>

        {/* ── Process header ── */}
        <div className="mb-8">
          <Breadcrumbs
            items={[{ label: "Processos Licitatórios", href: "/processos" }, { label: "Detalhes do Processo" }]}
            className="mb-3"
          />
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-2xl font-bold text-foreground truncate">{process.name}</h1>
                <Badge variant="secondary" className="shrink-0">{STATUS_LABELS[process.status]}</Badge>
              </div>
              <p className="text-muted-foreground text-sm">{process.object}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/parecer-juridico/novo?processId=${process.id}&type=processo`)}
              >
                <Scale className="mr-1.5 h-4 w-4" />
                Parecer
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportReport} disabled={exportingReport}>
                {exportingReport ? (
                  <InlineLoader className="mr-1.5" />
                ) : (
                  <FileText className="mr-1.5 h-4 w-4" />
                )}
                Relatório
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const p = new URLSearchParams({
                    source: "process",
                    processId: process.id.toString(),
                    object: process.name,
                    value: String(process.estimatedValue ?? 0),
                  });
                  navigate(`/contracts/new?${p}`);
                }}
              >
                <FileText className="mr-1.5 h-4 w-4" />
                Contrato
              </Button>
              <Button size="sm" onClick={() => setPublicationModalOpen(true)}>
                <Download className="mr-1.5 h-4 w-4" />
                Publicar
              </Button>
              <MembersDialog processId={processId} processName={process.name} />
            </div>
          </div>

          {/* Info chips */}
          <div className="flex flex-wrap gap-3 mt-4">
            {[
              { label: "Valor estimado", value: formatCurrency(process.estimatedValue) },
              { label: "Modalidade", value: process.modality?.replace(/_/g, " ") ?? "—" },
              { label: "Categoria", value: process.category ?? "—" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-muted/50 rounded-lg px-4 py-2 border border-border">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-sm font-semibold capitalize">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Guided workflow ── */}
        <div className="space-y-6">
          {/* Timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Fluxo Licitatório — Lei 14.133/21</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start">
                {DOC_ORDER.map((docType, i) => (
                  <div key={docType} className="flex items-center flex-1 min-w-0">
                    <TimelineStep
                      docType={docType}
                      index={i}
                      status={stepStatuses[docType]}
                      doc={docMap[docType]}
                      activeTab={activeTab}
                      onTabChange={setActiveTab}
                    />
                    {i < DOC_ORDER.length - 1 && (
                      <div
                        className={cn(
                          "h-0.5 flex-1 mx-2 mb-6 transition-colors",
                          stepStatuses[DOC_ORDER[i + 1]] !== "locked" ? "bg-primary/40" : "bg-border"
                        )}
                      />
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Document tabs */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base">Documentos do Processo</CardTitle>
                <div className="flex gap-2 flex-wrap">
                  {(process.status === "em_etp" || process.status === "em_tr") && docMap.etp && (
                    <Button variant="outline" size="sm" onClick={() => setTrItemsModalOpen(true)}>
                      <FileText className="mr-1.5 h-4 w-4" />
                      Itens do TR
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <input
                ref={docActions.uploadInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx"
                onChange={docActions.handleFileSelected}
              />
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DocType)}>
                <TabsList className="grid w-full grid-cols-4 mb-6">
                  {DOC_ORDER.map((docType) => {
                    const status = stepStatuses[docType];
                    const isDone = status === "done-ai" || status === "done-upload";
                    const locked = PREREQUISITES[docType] !== null && !docMap[PREREQUISITES[docType]!];
                    return (
                      <TabsTrigger
                        key={docType}
                        value={docType}
                        disabled={locked}
                        className={cn("gap-1.5 text-xs sm:text-sm", locked && "opacity-40")}
                      >
                        {isDone ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                        ) : locked ? (
                          <Lock className="h-3.5 w-3.5 shrink-0" />
                        ) : null}
                        {DOC_LABELS[docType].short}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
                {DOC_ORDER.map((docType) => (
                  <TabsContent key={docType} value={docType}>
                    <div className="mb-4 pb-4 border-b border-border">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{DOC_LABELS[docType].long}</h3>
                        <StepBadge status={stepStatuses[docType]} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{DOC_LABELS[docType].description}</p>
                    </div>
                    <DocTabContent
                      docType={docType}
                      status={stepStatuses[docType]}
                      doc={docMap[docType]}
                      processId={process.id}
                      actions={documentActions}
                    />
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          {/* Activity log */}
          {activities && activities.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Histórico de Atividades</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="relative border-l border-border space-y-4 ml-2">
                  {activities.map((activity: any) => (
                    <li key={activity.id} className="ml-4">
                      <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-primary/60 border-2 border-background" />
                      <p className="text-sm text-foreground">{activity.action}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(activity.createdAt)}</p>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}
        </div>
      </main>

      {/* ── Modals ── */}
      <TRItemsModal
        processId={processId}
        open={trItemsModalOpen}
        onOpenChange={setTrItemsModalOpen}
        onSuccess={invalidate}
      />
      <PublicationPackageModal
        processId={processId}
        open={publicationModalOpen}
        onOpenChange={setPublicationModalOpen}
      />
    </div>
  );
}
