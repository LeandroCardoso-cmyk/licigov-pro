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
} from "lucide-react";
import { useLocation, useParams } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { APP_LOGO } from "@/const";
import { useTheme } from "@/contexts/ThemeContext";
import { Moon, Sun } from "lucide-react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { DocumentEditor } from "@/components/DocumentEditor";
import { MembersDialog } from "@/components/MembersDialog";
import { NotificationBell } from "@/components/NotificationBell";
// import { GlobalSearch } from "@/components/GlobalSearch"; // Removido temporariamente
import { VersionHistoryDialog } from "@/components/VersionHistoryDialog";
import { CommentsSection } from "@/components/CommentsSection";

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
  const { theme, toggleTheme } = useTheme();
  const [, navigate] = useLocation();
  const params = useParams();
  const processId = parseInt(params.id || "0");
  const [editingDocumentId, setEditingDocumentId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState<string>("");

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
      toast.success(`${data.documentType.toUpperCase()} gerado com sucesso!`, {
        description: "O documento foi gerado automaticamente pela IA.",
      });
      // Invalidar queries para atualizar a interface
      utils.processes.getById.invalidate({ id: processId });
      utils.documents.listByProcess.invalidate({ processId });
      utils.activities.listByProcess.invalidate({ processId });
    },
  });

  const utils = trpc.useUtils();

  const handleGenerateNext = () => {
    generateNextMutation.mutate({ processId });
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
          createNewVersion: false, // Não criar nova versão no auto-save
        });
        setEditingContent(content);
      } catch (error) {
        console.error('Auto-save failed:', error);
        // Não mostrar erro ao usuário para não interromper edição
      }
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

  // Determinar qual documento exibir
  // Estado para controlar qual documento está sendo visualizado
  const [activeTab, setActiveTab] = useState<"etp" | "tr" | "dfd" | "edital">("etp");

  // Determinar qual documento exibir baseado na aba ativa
  const currentDocument = 
    activeTab === "etp" ? etpDocument :
    activeTab === "tr" ? trDocument :
    activeTab === "dfd" ? dfdDocument :
    activeTab === "edital" ? editalDocument : null;

  // Verificar se pode avançar
  const canAdvance = 
    (process.status === "em_etp" && etpDocument) ||
    (process.status === "em_tr" && trDocument) ||
    (process.status === "em_dfd" && dfdDocument);

  const nextDocumentLabel = 
    process.status === "em_etp" ? "TR" :
    process.status === "em_tr" ? "DFD" :
    process.status === "em_dfd" ? "Edital" : null;

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
              <GlobalSearch />
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
              <h1 className="text-3xl font-bold text-foreground mb-2">{process.name}</h1>
              <p className="text-muted-foreground">{process.object}</p>
            </div>
            <div className="flex items-center gap-3">
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
              {(["etp", "tr", "dfd", "edital"] as const).map((docType, index) => {
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
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)} className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="etp" disabled={!etpDocument}>
                  ETP
                </TabsTrigger>
                <TabsTrigger value="tr" disabled={!trDocument}>
                  TR
                </TabsTrigger>
                <TabsTrigger value="dfd" disabled={!dfdDocument}>
                  DFD
                </TabsTrigger>
                <TabsTrigger value="edital" disabled={!editalDocument}>
                  Edital
                </TabsTrigger>
              </TabsList>

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
                              Gerado em {formatDate(etpDocument.createdAt)} • Versão {etpDocument.version}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(etpDocument.id)} disabled={downloadingPdf}>
                              <Download className="mr-2 h-4 w-4" />
                              {downloadingPdf ? 'Gerando...' : 'PDF'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleDownloadDOCX(etpDocument.id)} disabled={downloadingDocx}>
                              <Download className="mr-2 h-4 w-4" />
                              {downloadingDocx ? 'Gerando...' : 'DOCX'}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleEditDocument(etpDocument.id, etpDocument.content || '')}>
                              <Edit className="mr-2 h-4 w-4" />
                              Editar
                            </Button>
                            <VersionHistoryDialog documentId={etpDocument.id} documentType="etp" />
                          </div>
                        </div>
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <Streamdown>{etpDocument.content || ""}</Streamdown>
                        </div>
                        <div className="mt-6">
                          <CommentsSection documentId={etpDocument.id} processId={process.id} />
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>ETP ainda não foi gerado</p>
                  </div>
                )}
              </TabsContent>

              {/* TR Tab */}
              <TabsContent value="tr" className="mt-6">
                {trDocument ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold">{documentLabels.tr}</h3>
                        <p className="text-sm text-muted-foreground">
                          Gerado em {formatDate(trDocument.createdAt)} • Versão {trDocument.version}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(trDocument.id)} disabled={downloadingPdf}>
                          <Download className="mr-2 h-4 w-4" />
                          {downloadingPdf ? 'Gerando...' : 'PDF'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDownloadDOCX(trDocument.id)} disabled={downloadingDocx}>
                          <Download className="mr-2 h-4 w-4" />
                          {downloadingDocx ? 'Gerando...' : 'DOCX'}
                        </Button>
                        <Button variant="outline" size="sm">
                          <Edit className="mr-2 h-4 w-4" />
                          Editar
                        </Button>
                      </div>
                    </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <Streamdown>{trDocument.content || ""}</Streamdown>
                    </div>
                    <div className="mt-6">
                      <CommentsSection documentId={trDocument.id} processId={process.id} />
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>TR ainda não foi gerado</p>
                  </div>
                )}
              </TabsContent>

              {/* DFD Tab */}
              <TabsContent value="dfd" className="mt-6">
                {dfdDocument ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold">{documentLabels.dfd}</h3>
                        <p className="text-sm text-muted-foreground">
                          Gerado em {formatDate(dfdDocument.createdAt)} • Versão {dfdDocument.version}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(dfdDocument.id)} disabled={downloadingPdf}>
                          <Download className="mr-2 h-4 w-4" />
                          {downloadingPdf ? 'Gerando...' : 'PDF'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDownloadDOCX(dfdDocument.id)} disabled={downloadingDocx}>
                          <Download className="mr-2 h-4 w-4" />
                          {downloadingDocx ? 'Gerando...' : 'DOCX'}
                        </Button>
                        <Button variant="outline" size="sm">
                          <Edit className="mr-2 h-4 w-4" />
                          Editar
                        </Button>
                      </div>
                    </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <Streamdown>{dfdDocument.content || ""}</Streamdown>
                    </div>
                    <div className="mt-6">
                      <CommentsSection documentId={dfdDocument.id} processId={process.id} />
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>DFD ainda não foi gerado</p>
                  </div>
                )}
              </TabsContent>

              {/* Edital Tab */}
              <TabsContent value="edital" className="mt-6">
                {editalDocument ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-semibold">{documentLabels.edital}</h3>
                        <p className="text-sm text-muted-foreground">
                          Gerado em {formatDate(editalDocument.createdAt)} • Versão {editalDocument.version}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleDownloadPDF(editalDocument.id)} disabled={downloadingPdf}>
                          <Download className="mr-2 h-4 w-4" />
                          {downloadingPdf ? 'Gerando...' : 'PDF'}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => handleDownloadDOCX(editalDocument.id)} disabled={downloadingDocx}>
                          <Download className="mr-2 h-4 w-4" />
                          {downloadingDocx ? 'Gerando...' : 'DOCX'}
                        </Button>
                        <Button variant="outline" size="sm">
                          <Edit className="mr-2 h-4 w-4" />
                          Editar
                        </Button>
                      </div>
                    </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <Streamdown>{editalDocument.content || ""}</Streamdown>
                    </div>
                    <div className="mt-6">
                      <CommentsSection documentId={editalDocument.id} processId={process.id} />
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <FileText className="mx-auto h-12 w-12 mb-4 opacity-50" />
                    <p>Edital ainda não foi gerado</p>
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
    </div>
  );
}
