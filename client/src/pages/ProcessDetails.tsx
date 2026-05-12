import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  FileText,
  Download,
  Edit,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Scale,
  Upload,
  RefreshCw,
  Lock,
  Bot,
  UploadCloud,
  Clock,
  ChevronRight,
} from "lucide-react";
import { useLocation, useParams } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useRef } from "react";
import { APP_LOGO } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { DocumentEditor } from "@/components/DocumentEditor";
import { MembersDialog } from "@/components/MembersDialog";
import { NotificationBell } from "@/components/NotificationBell";
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { CommentsSection } from "@/components/CommentsSection";
import { TRItemsModal } from "@/components/TRItemsModal";
import { PublicationPackageModal } from "@/components/process/PublicationPackageModal";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocType = "dfd" | "etp" | "tr" | "edital";
type StepStatus = "done-ai" | "done-upload" | "generating" | "uploading" | "pending" | "locked";

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_LABELS: Record<DocType, { short: string; long: string; description: string }> = {
  dfd: {
    short: "DFD",
    long: "Documento Formalizador de Demanda",
    description: "Formaliza a necessidade da contratação e dá início ao processo (art. 12, VII — Lei 14.133/21)",
  },
  etp: {
    short: "ETP",
    long: "Estudo Técnico Preliminar",
    description: "Análise técnica e econômica que fundamenta a decisão de contratar (art. 18 — Lei 14.133/21)",
  },
  tr: {
    short: "TR",
    long: "Termo de Referência",
    description: "Define o objeto da contratação, especificações técnicas e condições de execução (art. 6º, XXIII — Lei 14.133/21)",
  },
  edital: {
    short: "Edital",
    long: "Edital de Licitação",
    description: "Instrumento convocatório com todas as regras do certame licitatório (art. 25 — Lei 14.133/21)",
  },
};

const STATUS_LABELS: Record<string, string> = {
  em_dfd: "Em DFD",
  em_etp: "Em ETP",
  em_tr: "Em TR",
  em_edital: "Em Edital",
  concluido: "Concluído",
};

const DOC_ORDER: DocType[] = ["dfd", "etp", "tr", "edital"];

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
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");
  const [trItemsModalOpen, setTrItemsModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<DocType>("dfd");
  const [generatingDoc, setGeneratingDoc] = useState<DocType | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState<DocType | null>(null);
  const [downloadingUpload, setDownloadingUpload] = useState<number | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadDocType = useRef<DocType | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: process, isLoading: processLoading } = trpc.processes.getById.useQuery({ id: processId });
  const { data: documents, isLoading: documentsLoading } = trpc.documents.listByProcess.useQuery({ processId });
  const { data: activities } = trpc.activities.listByProcess.useQuery({ processId });
  const utils = trpc.useUtils();

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const invalidate = () => {
    utils.processes.getById.invalidate({ id: processId });
    utils.documents.listByProcess.invalidate({ processId });
    utils.activities.listByProcess.invalidate({ processId });
  };

  const generateDocumentMutation = trpc.documents.generateDocument.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.docType.toUpperCase()} gerado com sucesso!`);
      setGeneratingDoc(null);
      setActiveTab(data.docType as DocType);
      invalidate();
    },
    onError: (err) => {
      toast.error("Erro ao gerar documento", { description: err.message });
      setGeneratingDoc(null);
    },
  });

  const uploadDocumentMutation = trpc.documents.uploadDocument.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.docType.toUpperCase()} enviado com sucesso!`);
      setUploadingDoc(null);
      setActiveTab(data.docType as DocType);
      invalidate();
    },
    onError: (err) => {
      toast.error("Erro ao enviar documento", { description: err.message });
      setUploadingDoc(null);
    },
  });

  const updateDocumentMutation = trpc.documents.updateDocument.useMutation({
    onSuccess: (data) => {
      toast.success("Documento atualizado!", { description: `Versão ${data.version} salva.` });
      setEditingDocumentId(null);
      setEditingContent("");
      utils.documents.listByProcess.invalidate({ processId });
      utils.activities.listByProcess.invalidate({ processId });
    },
  });


  const downloadPdfMutation = trpc.documents.downloadPdf.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: data.filename }).click();
      URL.revokeObjectURL(url);
      toast.success("PDF baixado!");
      setDownloadingPdf(false);
    },
    onError: () => setDownloadingPdf(false),
  });

  const downloadDocxMutation = trpc.documents.downloadDocx.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0))], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: data.filename }).click();
      URL.revokeObjectURL(url);
      toast.success("DOCX baixado!");
      setDownloadingDocx(false);
    },
    onError: () => setDownloadingDocx(false),
  });

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const [downloadingUpload, setDownloadingUpload] = useState<number | null>(null);

  const handleDownloadUploaded = async (documentId: number) => {
    setDownloadingUpload(documentId);
    try {
      const result = await utils.documents.getDownloadUrl.fetch({ documentId });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Erro ao gerar link de download. Tente novamente.");
    } finally {
      setDownloadingUpload(null);
    }
  };

  const handleGenerateNext = () => {
    generateNextMutation.mutate({ processId });
  };

  const handleGenerateDocument = (docType: DocType) => {
    setGeneratingDoc(docType);
    generateDocumentMutation.mutate({ processId, docType });
  };

  const handleUploadClick = (docType: DocType) => {
    pendingUploadDocType.current = docType;
    uploadInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const docType = pendingUploadDocType.current;
    if (!file || !docType) return;
    e.target.value = "";
    setUploadingDoc(docType);
    const reader = new FileReader();
    reader.onload = () => {
      uploadDocumentMutation.mutate({
        processId,
        docType,
        fileName: file.name,
        fileBase64: (reader.result as string).split(",")[1],
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadUploaded = async (documentId: number) => {
    setDownloadingUpload(documentId);
    try {
      const result = await utils.documents.getDownloadUrl.fetch({ documentId });
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Erro ao gerar link de download.");
    } finally {
      setDownloadingUpload(null);
    }
  };

  const handleExportReport = async () => {
    setExportingReport(true);
    try {
      const result = await exportReportMutation.mutateAsync({ processId });
      const blob = new Blob([Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: result.filename });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Relatório exportado!");
    } catch {
      toast.error("Falha ao exportar relatório.");
    } finally {
      setExportingReport(false);
    }
  };

  const handleSaveEdit = (content: string) => {
    if (editingDocumentId) updateDocumentMutation.mutate({ documentId: editingDocumentId, content });
  };

  const handleAutoSave = async (content: string) => {
    if (!editingDocumentId) return;
    try {
      await updateDocumentMutation.mutateAsync({ documentId: editingDocumentId, content });
      setEditingContent(content);
    } catch {}
  };

  // ── Formatters ────────────────────────────────────────────────────────────────

  const formatDate = (date: Date) =>
    new Date(date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

  const formatCurrency = (cents: number | null | undefined) =>
    cents ? (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "R$ 0,00";

  // ── Loading / error states ────────────────────────────────────────────────────

  if (processLoading || documentsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
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

  const docMap: Record<DocType, (typeof documents)[number] | undefined> = {
    dfd: documents?.find((d) => d.type === "dfd"),
    etp: documents?.find((d) => d.type === "etp"),
    tr: documents?.find((d) => d.type === "tr"),
    edital: documents?.find((d) => d.type === "edital"),
  };

  const prerequisites: Record<DocType, DocType | null> = {
    dfd: null,
    etp: "dfd",
    tr: "etp",
    edital: "tr",
  };

  function getStepStatus(docType: DocType): StepStatus {
    if (generatingDoc === docType) return "generating";
    if (uploadingDoc === docType) return "uploading";
    const doc = docMap[docType];
    if (doc) return doc.sourceType === "upload" ? "done-upload" : "done-ai";
    const prereq = prerequisites[docType];
    if (prereq && !docMap[prereq]) return "locked";
    return "pending";
  }

  const stepStatuses = Object.fromEntries(DOC_ORDER.map((d) => [d, getStepStatus(d)])) as Record<DocType, StepStatus>;

  const isTabLocked = (docType: DocType) => {
    const prereq = prerequisites[docType];
    return prereq !== null && !docMap[prereq];
  };

  // ── Render helpers ────────────────────────────────────────────────────────────

  function StepBadge({ status }: { status: StepStatus }) {
    if (status === "done-ai")
      return (
        <Badge variant="secondary" className="gap-1 text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
          <Bot className="h-3 w-3" /> Gerado por IA
        </Badge>
      );
    if (status === "done-upload")
      return (
        <Badge variant="secondary" className="gap-1 text-xs bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
          <UploadCloud className="h-3 w-3" /> Upload
        </Badge>
      );
    if (status === "generating")
      return (
        <Badge variant="secondary" className="gap-1 text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
          <Loader2 className="h-3 w-3 animate-spin" /> Gerando…
        </Badge>
      );
    if (status === "uploading")
      return (
        <Badge variant="secondary" className="gap-1 text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
          <Loader2 className="h-3 w-3 animate-spin" /> Enviando…
        </Badge>
      );
    if (status === "pending")
      return (
        <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" /> Pendente
        </Badge>
      );
    return (
      <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
        <Lock className="h-3 w-3" /> Bloqueado
      </Badge>
    );
  }

  function TimelineStep({ docType, index }: { docType: DocType; index: number }) {
    const status = stepStatuses[docType];
    const isDone = status === "done-ai" || status === "done-upload";
    const isActive = status === "pending" || status === "generating" || status === "uploading";
    const isLocked = status === "locked";

    return (
      <button
        onClick={() => !isLocked && setActiveTab(docType)}
        disabled={isLocked}
        className={cn(
          "flex flex-col items-center gap-2 min-w-0 flex-1 group",
          isLocked ? "cursor-not-allowed opacity-50" : "cursor-pointer"
        )}
      >
        <div
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all",
            isDone && "bg-green-500 border-green-500 text-white",
            isActive && activeTab === docType && "bg-primary border-primary text-primary-foreground",
            isActive && activeTab !== docType && "border-primary text-primary bg-background",
            isLocked && "border-border text-muted-foreground bg-muted"
          )}
        >
          {isDone ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : isLocked ? (
            <Lock className="h-4 w-4" />
          ) : status === "generating" || status === "uploading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <span className="text-sm font-bold">{index + 1}</span>
          )}
        </div>

        <div className="text-center">
          <p className={cn("text-xs font-semibold", isLocked ? "text-muted-foreground" : "text-foreground")}>
            {DOC_LABELS[docType].short}
          </p>
          {isDone && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              v{docMap[docType]?.version}
              {docMap[docType]?.sourceType === "upload" ? " · Upload" : " · IA"}
            </p>
          )}
        </div>
      </button>
    );
  }

  function DocActions({ docType, doc }: { docType: DocType; doc: NonNullable<typeof docMap[DocType]> }) {
    const isGenerating = generatingDoc === docType;
    const isUploading = uploadingDoc === docType;

    return (
      <div className="flex flex-wrap gap-2">
        {/* Regenerar com IA */}
        <Button variant="outline" size="sm" onClick={() => handleGenerateDocument(docType)} disabled={isGenerating || isUploading}>
          {isGenerating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Regenerar com IA
        </Button>

        {/* Upload nova versão */}
        <Button variant="outline" size="sm" onClick={() => handleUploadClick(docType)} disabled={isGenerating || isUploading}>
          {isUploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
          Nova versão
        </Button>

        {/* Downloads — só para docs com conteúdo markdown */}
        {doc.content && (
          <>
            <Button variant="outline" size="sm" onClick={() => { setDownloadingPdf(true); downloadPdfMutation.mutate({ documentId: doc.id }); }} disabled={downloadingPdf}>
              {downloadingPdf ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setDownloadingDocx(true); downloadDocxMutation.mutate({ documentId: doc.id }); }} disabled={downloadingDocx}>
              {downloadingDocx ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              DOCX
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setEditingDocumentId(doc.id); setEditingContent(doc.content!); }}>
              <Edit className="mr-1.5 h-3.5 w-3.5" />
              Editar
            </Button>
          </>
        )}

        {/* Download S3 — para uploads */}
        {doc.s3Key && (
          <Button variant="outline" size="sm" onClick={() => handleDownloadUploaded(doc.id)} disabled={downloadingUpload === doc.id}>
            {downloadingUpload === doc.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            Baixar arquivo
          </Button>
        )}

        {/* Histórico */}
        <VersionHistoryDialog documentId={doc.id} documentType={docType} />
      </div>
    );
  }

  function DocTabContent({ docType }: { docType: DocType }) {
    const status = stepStatuses[docType];
    const doc = docMap[docType];
    const prereq = prerequisites[docType];
    const info = DOC_LABELS[docType];

    // Locked
    if (status === "locked") {
      const prereqLabel = prereq ? DOC_LABELS[prereq].short : "";
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            <Lock className="h-7 w-7 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground mb-1">{info.short} bloqueado</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Complete o <strong>{prereqLabel}</strong> primeiro para liberar esta etapa.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => prereq && setActiveTab(prereq)}>
            Ir para {prereqLabel}
            <ChevronRight className="ml-1.5 h-4 w-4" />
          </Button>
        </div>
      );
    }

    // Editing
    if (doc && editingDocumentId === doc.id) {
      return (
        <DocumentEditor
          initialContent={editingContent}
          onSave={handleSaveEdit}
          onCancel={() => { setEditingDocumentId(null); setEditingContent(""); }}
          isSaving={updateDocumentMutation.isPending}
          autoSave={true}
          onAutoSave={handleAutoSave}
        />
      );
    }

    // Document exists — show content
    if (doc) {
      return (
        <div className="space-y-6">
          {/* Doc header */}
          <div className="flex items-start justify-between gap-4 pb-4 border-b border-border">
            <div className="flex items-center gap-3 flex-wrap">
              <StepBadge status={status} />
              <span className="text-xs text-muted-foreground">
                Versão {doc.version} · {formatDate(doc.createdAt)}
              </span>
            </div>
            <DocActions docType={docType} doc={doc} />
          </div>

          {/* Content */}
          {doc.content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Streamdown>{doc.content}</Streamdown>
            </div>
          ) : (
            <div className="flex flex-col items-center py-10 gap-3 text-muted-foreground">
              <UploadCloud className="h-10 w-10 opacity-50" />
              <p className="text-sm">Arquivo enviado via upload</p>
            </div>
          )}

          {/* Comments */}
          <CommentsSection documentId={doc.id} processId={process.id} />
        </div>
      );
    }

    // Pending — no doc yet, prerequisites met
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-6 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <FileText className="h-7 w-7 text-primary" />
        </div>
        <div className="max-w-md">
          <p className="font-semibold text-foreground mb-1">{info.long}</p>
          <p className="text-sm text-muted-foreground">{info.description}</p>
        </div>
        <div className="flex gap-3 flex-wrap justify-center">
          <Button
            onClick={() => handleGenerateDocument(docType)}
            disabled={generatingDoc === docType}
          >
            {generatingDoc === docType ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Gerar com IA
          </Button>
          <Button variant="outline" onClick={() => handleUploadClick(docType)} disabled={uploadingDoc === docType}>
            {uploadingDoc === docType ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Fazer upload
          </Button>
        </div>
      </div>
    );
  }

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
        {/* Back */}
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
              <Button variant="outline" size="sm" onClick={() => navigate(`/parecer-juridico/novo?processId=${process.id}&type=processo`)}>
                <Scale className="mr-1.5 h-4 w-4" />
                Parecer
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportReport} disabled={exportingReport}>
                {exportingReport ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileText className="mr-1.5 h-4 w-4" />}
                Relatório
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const p = new URLSearchParams({ source: "process", processId: process.id.toString(), object: process.name, value: String(process.estimatedValue ?? 0) });
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
                    <TimelineStep docType={docType} index={i} />
                    {i < DOC_ORDER.length - 1 && (
                      <div
                        className={cn(
                          "h-0.5 flex-1 mx-2 mb-6 transition-colors",
                          stepStatuses[DOC_ORDER[i + 1]] !== "locked"
                            ? "bg-primary/40"
                            : "bg-border"
                        )}
                      />
                    )}
                  </div>
                ))}
              </div>

            </div>
          </CardHeader>
          <CardContent>
            {/* hidden input for file uploads */}
            <input
              ref={uploadInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx"
              onChange={handleFileSelected}
            />

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="dfd">
                  {dfdDocument ? <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" /> : null}
                  DFD
                </TabsTrigger>
                <TabsTrigger value="etp">
                  {etpDocument ? <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" /> : null}
                  ETP
                </TabsTrigger>
                <TabsTrigger value="tr">
                  {trDocument ? <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" /> : null}
                  TR
                </TabsTrigger>
                <TabsTrigger value="edital">
                  {editalDocument ? <CheckCircle2 className="mr-1 h-3 w-3 text-green-500" /> : null}
                  Edital
                </TabsTrigger>
              </TabsList>

              {/* DFD Tab — primeiro documento (Lei 14.133) */}
              <TabsContent value="dfd" className="mt-6">
                {dfdDocument ? (
                  <div>
                    {editingDocumentId === dfdDocument.id ? (
                      <DocumentEditor
                        initialContent={editingContent}
                        onSave={handleSaveEdit}
                        onCancel={handleCancelEdit}
                        isSaving={updateDocumentMutation.isPending}
                        autoSave={true}
                        onAutoSave={handleAutoSave}
                      />
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold">{documentLabels.dfd}</h3>
                            <p className="text-sm text-muted-foreground">
                              {dfdDocument.sourceType === "upload" ? "Enviado" : "Gerado"} em {formatDate(dfdDocument.createdAt)} • Versão {dfdDocument.version}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleGenerateDocument("dfd")} disabled={generatingDoc === "dfd"}>
                              {generatingDoc === "dfd" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                              Regenerar
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleUploadClick("dfd")} disabled={uploadingDoc === "dfd"}>
                              {uploadingDoc === "dfd" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                              Upload
                            </Button>
                            {dfdDocument.content && (
                              <>
                                <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(dfdDocument.id)} disabled={downloadingPdf}>
                                  <Download className="mr-2 h-4 w-4" />
                                  PDF
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleDownloadDOCX(dfdDocument.id)} disabled={downloadingDocx}>
                                  <Download className="mr-2 h-4 w-4" />
                                  DOCX
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleEditDocument(dfdDocument.id, dfdDocument.content || '')}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Editar
                                </Button>
                                <VersionHistoryDialog documentId={dfdDocument.id} documentType="dfd" />
                              </>
                            )}
                            {dfdDocument.s3Key && (
                              <Button variant="outline" size="sm" onClick={() => handleDownloadUploaded(dfdDocument.id)} disabled={downloadingUpload === dfdDocument.id}>
                                {downloadingUpload === dfdDocument.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                Baixar Arquivo
                              </Button>
                            )}
                          </div>
                        </div>
                        {dfdDocument.content ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <Streamdown>{dfdDocument.content}</Streamdown>
                          </div>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <FileText className="mx-auto h-10 w-10 mb-3 opacity-50" />
                            <p>Arquivo enviado via upload</p>
                          </div>
                        )}
                        <div className="mt-6">
                          <CommentsSection documentId={dfdDocument.id} processId={process.id} />
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="mx-auto h-12 w-12 mb-4 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground mb-2 font-medium">DFD ainda não foi criado</p>
                    <p className="text-sm text-muted-foreground mb-6">O Documento Formalizador de Demanda é o primeiro passo do processo licitatório (Lei 14.133).</p>
                    <div className="flex gap-3 justify-center">
                      <Button onClick={() => handleGenerateDocument("dfd")} disabled={generatingDoc === "dfd"}>
                        {generatingDoc === "dfd" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Gerar com IA
                      </Button>
                      <Button variant="outline" onClick={() => handleUploadClick("dfd")} disabled={uploadingDoc === "dfd"}>
                        {uploadingDoc === "dfd" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                        Fazer Upload
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* ETP Tab */}
              <TabsContent value="etp" className="mt-6">
                {etpDocument ? (
                  <div>
                    {editingDocumentId === etpDocument.id ? (
                      <DocumentEditor
                        initialContent={editingContent}
                        onSave={handleSaveEdit}
                        onCancel={handleCancelEdit}
                        isSaving={updateDocumentMutation.isPending}
                        autoSave={true}
                        onAutoSave={handleAutoSave}
                      />
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold">{documentLabels.etp}</h3>
                            <p className="text-sm text-muted-foreground">
                              {etpDocument.sourceType === "upload" ? "Enviado" : "Gerado"} em {formatDate(etpDocument.createdAt)} • Versão {etpDocument.version}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleGenerateDocument("etp")} disabled={generatingDoc === "etp"}>
                              {generatingDoc === "etp" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                              Regenerar
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleUploadClick("etp")} disabled={uploadingDoc === "etp"}>
                              {uploadingDoc === "etp" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                              Upload
                            </Button>
                            {etpDocument.content && (
                              <>
                                <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(etpDocument.id)} disabled={downloadingPdf}>
                                  <Download className="mr-2 h-4 w-4" />
                                  PDF
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleDownloadDOCX(etpDocument.id)} disabled={downloadingDocx}>
                                  <Download className="mr-2 h-4 w-4" />
                                  DOCX
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleEditDocument(etpDocument.id, etpDocument.content || '')}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Editar
                                </Button>
                                <VersionHistoryDialog documentId={etpDocument.id} documentType="etp" />
                              </>
                            )}
                            {etpDocument.s3Key && (
                              <Button variant="outline" size="sm" onClick={() => handleDownloadUploaded(etpDocument.id)} disabled={downloadingUpload === etpDocument.id}>
                                {downloadingUpload === etpDocument.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                Baixar Arquivo
                              </Button>
                            )}
                          </div>
                        </div>
                        {etpDocument.content ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <Streamdown>{etpDocument.content}</Streamdown>
                          </div>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <FileText className="mx-auto h-10 w-10 mb-3 opacity-50" />
                            <p>Arquivo enviado via upload</p>
                          </div>
                        )}
                        <div className="mt-6">
                          <CommentsSection documentId={etpDocument.id} processId={process.id} />
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="mx-auto h-12 w-12 mb-4 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground mb-2 font-medium">ETP ainda não foi criado</p>
                    <p className="text-sm text-muted-foreground mb-6">O Estudo Técnico Preliminar é gerado após o DFD.</p>
                    <div className="flex gap-3 justify-center">
                      <Button onClick={() => handleGenerateDocument("etp")} disabled={generatingDoc === "etp"}>
                        {generatingDoc === "etp" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Gerar com IA
                      </Button>
                      <Button variant="outline" onClick={() => handleUploadClick("etp")} disabled={uploadingDoc === "etp"}>
                        {uploadingDoc === "etp" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                        Fazer Upload
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* TR Tab */}
              <TabsContent value="tr" className="mt-6">
                {trDocument ? (
                  <div>
                    {editingDocumentId === trDocument.id ? (
                      <DocumentEditor
                        initialContent={editingContent}
                        onSave={handleSaveEdit}
                        onCancel={handleCancelEdit}
                        isSaving={updateDocumentMutation.isPending}
                        autoSave={true}
                        onAutoSave={handleAutoSave}
                      />
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold">{documentLabels.tr}</h3>
                            <p className="text-sm text-muted-foreground">
                              {trDocument.sourceType === "upload" ? "Enviado" : "Gerado"} em {formatDate(trDocument.createdAt)} • Versão {trDocument.version}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleGenerateDocument("tr")} disabled={generatingDoc === "tr"}>
                              {generatingDoc === "tr" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                              Regenerar
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleUploadClick("tr")} disabled={uploadingDoc === "tr"}>
                              {uploadingDoc === "tr" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                              Upload
                            </Button>
                            {trDocument.content && (
                              <>
                                <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(trDocument.id)} disabled={downloadingPdf}>
                                  <Download className="mr-2 h-4 w-4" />
                                  PDF
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleDownloadDOCX(trDocument.id)} disabled={downloadingDocx}>
                                  <Download className="mr-2 h-4 w-4" />
                                  DOCX
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleEditDocument(trDocument.id, trDocument.content || '')}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Editar
                                </Button>
                                <VersionHistoryDialog documentId={trDocument.id} documentType="tr" />
                              </>
                            )}
                            {trDocument.s3Key && (
                              <Button variant="outline" size="sm" onClick={() => handleDownloadUploaded(trDocument.id)} disabled={downloadingUpload === trDocument.id}>
                                {downloadingUpload === trDocument.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                Baixar Arquivo
                              </Button>
                            )}
                          </div>
                        </div>
                        {trDocument.content ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <Streamdown>{trDocument.content}</Streamdown>
                          </div>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <FileText className="mx-auto h-10 w-10 mb-3 opacity-50" />
                            <p>Arquivo enviado via upload</p>
                          </div>
                        )}
                        <div className="mt-6">
                          <CommentsSection documentId={trDocument.id} processId={process.id} />
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="mx-auto h-12 w-12 mb-4 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground mb-2 font-medium">TR ainda não foi criado</p>
                    <p className="text-sm text-muted-foreground mb-6">O Termo de Referência é gerado após o ETP.</p>
                    <div className="flex gap-3 justify-center">
                      <Button onClick={() => handleGenerateDocument("tr")} disabled={generatingDoc === "tr" || !etpDocument}>
                        {generatingDoc === "tr" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Gerar com IA
                      </Button>
                      <Button variant="outline" onClick={() => handleUploadClick("tr")} disabled={uploadingDoc === "tr"}>
                        {uploadingDoc === "tr" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                        Fazer Upload
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              {/* Edital Tab */}
              <TabsContent value="edital" className="mt-6">
                {editalDocument ? (
                  <div>
                    {editingDocumentId === editalDocument.id ? (
                      <DocumentEditor
                        initialContent={editingContent}
                        onSave={handleSaveEdit}
                        onCancel={handleCancelEdit}
                        isSaving={updateDocumentMutation.isPending}
                        autoSave={true}
                        onAutoSave={handleAutoSave}
                      />
                    ) : (
                      <>
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-semibold">{documentLabels.edital}</h3>
                            <p className="text-sm text-muted-foreground">
                              {editalDocument.sourceType === "upload" ? "Enviado" : "Gerado"} em {formatDate(editalDocument.createdAt)} • Versão {editalDocument.version}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleGenerateDocument("edital")} disabled={generatingDoc === "edital"}>
                              {generatingDoc === "edital" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                              Regenerar
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleUploadClick("edital")} disabled={uploadingDoc === "edital"}>
                              {uploadingDoc === "edital" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                              Upload
                            </Button>
                            {editalDocument.content && (
                              <>
                                <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(editalDocument.id)} disabled={downloadingPdf}>
                                  <Download className="mr-2 h-4 w-4" />
                                  PDF
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleDownloadDOCX(editalDocument.id)} disabled={downloadingDocx}>
                                  <Download className="mr-2 h-4 w-4" />
                                  DOCX
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => handleEditDocument(editalDocument.id, editalDocument.content || '')}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Editar
                                </Button>
                                <VersionHistoryDialog documentId={editalDocument.id} documentType="edital" />
                              </>
                            )}
                            {editalDocument.s3Key && (
                              <Button variant="outline" size="sm" onClick={() => handleDownloadUploaded(editalDocument.id)} disabled={downloadingUpload === editalDocument.id}>
                                {downloadingUpload === editalDocument.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                Baixar Arquivo
                              </Button>
                            )}
                          </div>
                        </div>
                        {editalDocument.content ? (
                          <div className="prose prose-sm dark:prose-invert max-w-none">
                            <Streamdown>{editalDocument.content}</Streamdown>
                          </div>
                        ) : (
                          <div className="text-center py-8 text-muted-foreground">
                            <FileText className="mx-auto h-10 w-10 mb-3 opacity-50" />
                            <p>Arquivo enviado via upload</p>
                          </div>
                        )}
                        <div className="mt-6">
                          <CommentsSection documentId={editalDocument.id} processId={process.id} />
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <FileText className="mx-auto h-12 w-12 mb-4 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground mb-2 font-medium">Edital ainda não foi criado</p>
                    <p className="text-sm text-muted-foreground mb-6">O Edital é o documento final do processo licitatório, gerado após o TR.</p>
                    <div className="flex gap-3 justify-center">
                      <Button onClick={() => handleGenerateDocument("edital")} disabled={generatingDoc === "edital" || !etpDocument || !trDocument}>
                        {generatingDoc === "edital" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                        Gerar com IA
                      </Button>
                      <Button variant="outline" onClick={() => handleUploadClick("edital")} disabled={uploadingDoc === "edital"}>
                        {uploadingDoc === "edital" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                        Fazer Upload
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Empty state (not needed anymore) */}
        {false && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 text-primary animate-spin mb-4" />
              <h3 className="text-lg font-semibold text-foreground mb-2">
                Gerando ETP...
              </h3>
              <p className="text-muted-foreground text-center max-w-md">
                A inteligência artificial está analisando os dados do processo e gerando o Estudo
                Técnico Preliminar baseado na Lei 14.133/21. Isso pode levar alguns segundos.
              </p>
            </CardContent>
          </Card>

          {/* Document tabs */}
          <Card>
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base">Documentos do Processo</CardTitle>
                <div className="flex gap-2 flex-wrap">
                  {/* Adicionar itens ao TR */}
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
              {/* hidden upload input */}
              <input ref={uploadInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={handleFileSelected} />

              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as DocType)}>
                <TabsList className="grid w-full grid-cols-4 mb-6">
                  {DOC_ORDER.map((docType) => {
                    const status = stepStatuses[docType];
                    const isDone = status === "done-ai" || status === "done-upload";
                    const locked = isTabLocked(docType);
                    return (
                      <TabsTrigger
                        key={docType}
                        value={docType}
                        disabled={locked}
                        className={cn(
                          "gap-1.5 text-xs sm:text-sm",
                          locked && "opacity-40"
                        )}
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
                    {/* Step description header */}
                    <div className="mb-4 pb-4 border-b border-border">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{DOC_LABELS[docType].long}</h3>
                        <StepBadge status={stepStatuses[docType]} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{DOC_LABELS[docType].description}</p>
                    </div>
                    <DocTabContent docType={docType} />
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
                      <p className="text-xs text-muted-foreground">{formatDate(activity.createdAt)}</p>
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
      <PublicationPackageModal processId={processId} open={publicationModalOpen} onOpenChange={setPublicationModalOpen} />
    </div>
  );
}

