import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  FileText,
  Download,
  Edit,
  Loader2,
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  Sparkles,
  Scale,
  Upload,
  RefreshCw,
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

const statusLabels: Record<string, string> = {
  em_etp: "Em ETP",
  em_tr: "Em TR",
  em_dfd: "Em DFD",
  em_edital: "Em Edital",
  concluido: "Concluído",
};

const documentLabels: Record<string, string> = {
  etp: "Estudo Técnico Preliminar (ETP)",
  tr: "Termo de Referência (TR)",
  dfd: "Documento Formalizador de Demanda (DFD)",
  edital: "Edital",
};

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
  const [activeTab, setActiveTab] = useState<"dfd" | "etp" | "tr" | "edital">("dfd");
  const [generatingDoc, setGeneratingDoc] = useState<string | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadDocType = useRef<"dfd" | "etp" | "tr" | "edital" | null>(null);

  const { data: process, isLoading: processLoading } = trpc.processes.getById.useQuery({
    id: processId,
  });

  const { data: documents, isLoading: documentsLoading } = trpc.documents.listByProcess.useQuery({
    processId,
  });

  const { data: activities } = trpc.activities.listByProcess.useQuery({
    processId,
  });

  const generateNextMutation = trpc.documents.generateNext.useMutation({
    onSuccess: (data) => {
      if (data.documentType) {
        toast.success(`${String(data.documentType).toUpperCase()} gerado com sucesso!`, {
          description: "O documento foi gerado automaticamente pela IA.",
        });
      } else {
        toast.success("Processo concluído!");
      }
      utils.processes.getById.invalidate({ id: processId });
      utils.documents.listByProcess.invalidate({ processId });
      utils.activities.listByProcess.invalidate({ processId });
    },
  });

  const generateDocumentMutation = trpc.documents.generateDocument.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.docType.toUpperCase()} gerado com sucesso!`, {
        description: "Documento gerado pela IA.",
      });
      setGeneratingDoc(null);
      setActiveTab(data.docType as any);
      utils.processes.getById.invalidate({ id: processId });
      utils.documents.listByProcess.invalidate({ processId });
      utils.activities.listByProcess.invalidate({ processId });
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
      setActiveTab(data.docType as any);
      utils.processes.getById.invalidate({ id: processId });
      utils.documents.listByProcess.invalidate({ processId });
      utils.activities.listByProcess.invalidate({ processId });
    },
    onError: (err) => {
      toast.error("Erro ao enviar documento", { description: err.message });
      setUploadingDoc(null);
    },
  });

  const utils = trpc.useUtils();

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

  const handleGenerateDocument = (docType: "dfd" | "etp" | "tr" | "edital") => {
    setGeneratingDoc(docType);
    generateDocumentMutation.mutate({ processId, docType });
  };

  const handleUploadClick = (docType: "dfd" | "etp" | "tr" | "edital") => {
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
      const base64 = (reader.result as string).split(",")[1];
      uploadDocumentMutation.mutate({
        processId,
        docType,
        fileName: file.name,
        fileBase64: base64,
        mimeType: file.type,
      });
    };
    reader.readAsDataURL(file);
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (cents: number | null | undefined) => {
    if (!cents) return "R$ 0,00";
    return (cents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  };

  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);

  const downloadPdfMutation = trpc.documents.downloadPdf.useMutation({
    onSuccess: (data) => {
      // Converter base64 para blob e fazer download
      const byteCharacters = atob(data.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Download do PDF iniciado!');
      setDownloadingPdf(false);
    },
  });

  const updateDocumentMutation = trpc.documents.updateDocument.useMutation({
    onSuccess: (data) => {
      toast.success('Documento atualizado com sucesso!', {
        description: `Nova versão ${data.version} criada.`,
      });
      setEditingDocumentId(null);
      setEditingContent('');
      utils.documents.listByProcess.invalidate({ processId });
      utils.activities.listByProcess.invalidate({ processId });
    },
  });

  const handleEditDocument = (documentId: number, content: string) => {
    setEditingDocumentId(documentId);
    setEditingContent(content);
  };

  const handleSaveEdit = (content: string) => {
    if (editingDocumentId) {
      updateDocumentMutation.mutate({ documentId: editingDocumentId, content });
    }
  };

  const handleCancelEdit = () => {
    setEditingDocumentId(null);
    setEditingContent('');
  };

  const handleAutoSave = async (content: string) => {
    if (editingDocumentId) {
      // Auto-save silencioso - atualiza conteúdo sem criar nova versão
      try {
        await updateDocumentMutation.mutateAsync({
          documentId: editingDocumentId,
          content,
        });
        setEditingContent(content);
      } catch (error) {
        console.error('Auto-save failed:', error);
        // Não mostrar erro ao usuário para não interromper edição
      }
    }
  };

  const handleExportReport = async () => {
    setExportingReport(true);
    try {
      const result = await exportReportMutation.mutateAsync({ processId });
      
      // Converter base64 para blob
      const byteCharacters = atob(result.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: result.mimeType });
      
      // Criar link de download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success("Relatório exportado com sucesso!");
    } catch (error) {
      console.error("Erro ao exportar relatório:", error);
      toast.error("Falha ao exportar relatório. Tente novamente.");
    } finally {
      setExportingReport(false);
    }
  };

  const downloadDocxMutation = trpc.documents.downloadDocx.useMutation({
    onSuccess: (data) => {
      // Converter base64 para blob e fazer download
      const byteCharacters = atob(data.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = data.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success('Download do DOCX iniciado!');
      setDownloadingDocx(false);
    },
  });

  const handleDownloadPDF = (documentId: number) => {
    setDownloadingPdf(true);
    downloadPdfMutation.mutate({ documentId });
  };

  const handleDownloadDOCX = (documentId: number) => {
    setDownloadingDocx(true);
    downloadDocxMutation.mutate({ documentId });
  };

  if (processLoading || documentsLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!process) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <AlertCircle className="h-12 w-12 text-destructive mb-4" />
        <h2 className="text-2xl font-bold mb-2">Processo não encontrado</h2>
        <Button onClick={() => navigate("/dashboard")}>Voltar ao Dashboard</Button>
      </div>
    );
  }

  const etpDocument = documents?.find((doc) => doc.type === "etp");
  const trDocument = documents?.find((doc) => doc.type === "tr");
  const dfdDocument = documents?.find((doc) => doc.type === "dfd");
  const editalDocument = documents?.find((doc) => doc.type === "edital");

  // Determinar qual documento exibir baseado na aba ativa
  const currentDocument = 
    activeTab === "etp" ? etpDocument :
    activeTab === "tr" ? trDocument :
    activeTab === "dfd" ? dfdDocument :
    activeTab === "edital" ? editalDocument : null;

  // Lei 14.133: DFD → ETP → TR → Edital
  const canAdvance =
    (process.status === "em_dfd" && dfdDocument) ||
    (process.status === "em_etp" && etpDocument) ||
    (process.status === "em_tr" && trDocument) ||
    process.status === "em_edital";

  const nextDocumentLabel =
    process.status === "em_dfd" ? "ETP" :
    process.status === "em_etp" ? "TR" :
    process.status === "em_tr" ? "Edital" :
    process.status === "em_edital" ? "Concluir" : null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6">
          <div className="flex h-20 items-center justify-between">
            <div className="flex items-center gap-6">
              <img src={APP_LOGO} alt="LiciGov Pro" className="h-20 w-auto" />
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={toggleTheme}>
                  {theme === "dark" ? (
                    <Sun className="h-5 w-5" />
                  ) : (
                    <Moon className="h-5 w-5" />
                  )}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <div className="text-right">
                <p className="text-sm font-medium text-foreground">{user?.name}</p>
                <p className="text-xs text-muted-foreground">{user?.email}</p>
              </div>
              <Button variant="outline" size="sm" onClick={logout}>
                Sair
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {/* Breadcrumb */}
        <Button
          variant="ghost"
          className="mb-6 -ml-4"
          onClick={() => navigate("/dashboard")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar ao Dashboard
        </Button>

        {/* Process Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <Breadcrumbs items={[
                { label: "Processos Licitatórios", href: "/processos" },
                { label: "Detalhes do Processo" }
              ]} className="mb-2" />
              <h1 className="text-3xl font-bold text-foreground mb-2">{process.name}</h1>
              <p className="text-muted-foreground">{process.object}</p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setPublicationModalOpen(true)}
                variant="default"
                size="sm"
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                Preparar para Publicação
              </Button>
              <Button
                onClick={handleExportReport}
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={exportingReport}
              >
                {exportingReport ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Exportar Relatório
              </Button>
              <Button
                onClick={() => {
                  const params = new URLSearchParams({
                    source: 'process',
                    processId: process.id.toString(),
                    object: process.name,
                    value: String(process.estimatedValue ?? 0),
                  });
                  navigate(`/contracts/new?${params.toString()}`);
                }}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <FileText className="h-4 w-4" />
                Gerar Contrato
              </Button>
              <MembersDialog processId={processId} processName={process.name} />
              <Badge variant="secondary" className="text-sm px-4 py-2">
                {statusLabels[process.status]}
              </Badge>
            </div>
          </div>

          {/* Process Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Valor Estimado</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground">
                  {formatCurrency(process.estimatedValue)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Modalidade</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground capitalize">
                  {process.modality?.replace("_", " ")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Categoria</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-foreground capitalize">
                  {process.category}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Timeline */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Linha do Tempo dos Documentos</CardTitle>
            <CardDescription>Acompanhe o progresso da geração dos documentos</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              {(["dfd", "etp", "tr", "edital"] as const).map((docType, index) => {
                const doc = documents?.find((d: any) => d.type === docType);
                const isCompleted = !!doc;
                const isCurrent = process.status === `em_${docType}`;

                return (
                  <div key={docType} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          isCompleted
                            ? "bg-green-500 text-white"
                            : isCurrent
                            ? "bg-blue-500 text-white animate-pulse"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isCompleted ? (
                          <CheckCircle2 className="h-6 w-6" />
                        ) : isCurrent ? (
                          <Clock className="h-6 w-6" />
                        ) : (
                          <FileText className="h-6 w-6" />
                        )}
                      </div>
                      <p className="text-xs font-medium mt-2 text-center">
                        {docType.toUpperCase()}
                      </p>
                    </div>
                    {index < 3 && (
                      <div
                        className={`flex-1 h-1 mx-2 ${
                          isCompleted ? "bg-green-500" : "bg-muted"
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Document Content with Tabs */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between mb-4">
              <CardTitle>Documentos do Processo</CardTitle>
              <div className="flex gap-2">
                {/* Botão Solicitar Parecer Jurídico */}
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => navigate(`/parecer-juridico/novo?processId=${process.id}&type=processo`)}
                >
                  <Scale className="mr-2 h-4 w-4" />
                  Solicitar Parecer
                </Button>
                {/* Botão para adicionar itens ao TR (Lei 14.133/21) */}
                {(process.status === "em_etp" || process.status === "em_tr") && etpDocument && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTrItemsModalOpen(true)}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Adicionar Itens ao TR
                  </Button>
                )}
                {canAdvance && nextDocumentLabel && (
                  <Button 
                    variant="default" 
                    size="sm"
                    onClick={handleGenerateNext}
                    disabled={generateNextMutation.isPending}
                  >
                    {generateNextMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    Gerar {nextDocumentLabel}
                  </Button>
                )}
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
        )}

        {/* Activity Log */}
        {activities && activities.length > 0 && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Log de Atividades</CardTitle>
              <CardDescription>Histórico de ações realizadas neste processo</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {activities.map((activity: any) => (
                  <div key={activity.id} className="flex items-start gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full bg-primary mt-2" />
                    <div className="flex-1">
                      <p className="text-foreground">{activity.action}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(activity.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      {/* Modal para adicionar itens CATMAT/CATSER ao TR */}
      <TRItemsModal
        processId={processId}
        open={trItemsModalOpen}
        onOpenChange={setTrItemsModalOpen}
        onSuccess={() => {
          // Invalidar queries para atualizar a interface
          utils.processes.getById.invalidate({ id: processId });
          utils.documents.listByProcess.invalidate({ processId });
        }}
      />

      {/* Modal de Preparação para Publicação */}
      <PublicationPackageModal
        processId={processId}
        open={publicationModalOpen}
        onOpenChange={setPublicationModalOpen}
      />
    </div>
  );
}
