import { useAuth } from "@/_core/hooks/useAuth";
import { BackToDashboard } from "@/components/BackToDashboard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { 
  Scale, 
  Loader2, 
  Sparkles, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  FileText,
  Calendar,
  User,
  Tag,
  Download,
  BookmarkPlus,
  Shield,
  ShieldCheck
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff } from "lucide-react";
import { SetSignaturePasswordDialog } from "@/components/SetSignaturePasswordDialog";
import { SignatureHistory } from "@/components/SignatureHistory";

export default function LegalOpinionDetails() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/parecer-juridico/:id");
  const opinionId = params?.id ? parseInt(params.id) : null;
  const [showSignDialog, setShowSignDialog] = useState(false);
  const [showSetPasswordDialog, setShowSetPasswordDialog] = useState(false);
  const [signerRole, setSignerRole] = useState<"revisor" | "responsavel" | "gestor">("responsavel");
  const [signaturePassword, setSignaturePassword] = useState("");
  const [showSignaturePassword, setShowSignaturePassword] = useState(false);

  // Buscar parecer
  const { data: opinion, isLoading, refetch } = trpc.legalOpinions.getById.useQuery(
    { id: opinionId! },
    { enabled: !!opinionId }
  );

  // Verificar se usuário tem senha de assinatura
  const { data: hasPassword } = trpc.legalOpinions.hasSignaturePassword.useQuery(undefined, {
    enabled: !!user,
  });

  // Buscar histórico de assinaturas
  const { data: signatureHistoryData } = trpc.legalOpinions.getSignatureHistory.useQuery(
    { id: opinionId! },
    { enabled: !!opinionId }
  );

  // Mutation para gerar parecer
  const generateMutation = trpc.legalOpinions.generateOpinion.useMutation({
    onSuccess: () => {
      toast.success("Parecer gerado com sucesso!");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao gerar parecer");
    },
  });

  // Mutation para atualizar status
  const updateMutation = trpc.legalOpinions.update.useMutation({
    onSuccess: () => {
      toast.success("Status atualizado!");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao atualizar");
    },
  });

  // Mutations para exportação
  const exportPDFMutation = trpc.legalOpinions.exportPDF.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([Uint8Array.from(atob(data.buffer), c => c.charCodeAt(0))], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF baixado com sucesso!");
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao exportar PDF");
    },
  });

  const exportDOCXMutation = trpc.legalOpinions.exportDOCX.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([Uint8Array.from(atob(data.buffer), c => c.charCodeAt(0))], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("DOCX baixado com sucesso!");
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao exportar DOCX");
    },
  });

  // Mutation para assinar digitalmente
  const signMutation = trpc.legalOpinions.sign.useMutation({
    onSuccess: (data) => {
      toast.success(`✅ Parecer assinado digitalmente! (${data.signaturesCount}/${data.requiredSignatures})`);
      setShowSignDialog(false);
      setSignaturePassword("");
      refetch();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao assinar parecer");
    },
  });

  const handleSignClick = () => {
    if (!hasPassword) {
      setShowSetPasswordDialog(true);
      return;
    }
    setShowSignDialog(true);
  };

  const handleSign = () => {
    if (!signaturePassword) {
      toast.error("Digite sua senha de assinatura");
      return;
    }
    signMutation.mutate({
      id: opinion!.id,
      signerRole,
      signaturePassword,
    });
  };

  // Query para verificar assinatura
  const { data: signatureInfo } = trpc.legalOpinions.verifySignature.useQuery(
    { id: opinionId! },
    { enabled: !!opinionId && !!opinion?.signatureId }
  );

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!opinion) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-lg text-muted-foreground mb-4">Parecer não encontrado</p>
        <Button onClick={() => navigate("/parecer-juridico")}>
          Voltar para Pareceres
        </Button>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      draft: { label: "Rascunho", variant: "secondary" },
      in_review: { label: "Em Revisão", variant: "default" },
      approved: { label: "Aprovado", variant: "outline" },
      archived: { label: "Arquivado", variant: "destructive" },
    };
    const config = variants[status] || { label: status, variant: "outline" };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getConclusionIcon = (conclusion: string | null) => {
    if (!conclusion) return null;
    const icons: Record<string, JSX.Element> = {
      favorable: <CheckCircle2 className="h-5 w-5 text-green-600" />,
      unfavorable: <XCircle className="h-5 w-5 text-red-600" />,
      with_reservations: <AlertCircle className="h-5 w-5 text-yellow-600" />,
    };
    return icons[conclusion] || null;
  };

  const getConclusionLabel = (conclusion: string | null) => {
    if (!conclusion) return "Aguardando Análise";
    const labels: Record<string, string> = {
      favorable: "Favorável",
      unfavorable: "Desfavorável",
      with_reservations: "Com Ressalvas",
    };
    return labels[conclusion] || conclusion;
  };

  const getSourceTypeLabel = (sourceType: string) => {
    const labels: Record<string, string> = {
      process: "Processo Licitatório",
      direct_contract: "Contratação Direta",
      contract: "Contrato",
      other: "Outro",
    };
    return labels[sourceType] || sourceType;
  };

  const handleGenerate = async () => {
    if (!opinionId) return;
    await generateMutation.mutateAsync({ id: opinionId });
  };

  const handleApprove = async () => {
    if (!opinionId) return;
    await updateMutation.mutateAsync({
      id: opinionId,
      status: "approved",
      reviewedBy: user?.id,
    });
  };

  const isGenerating = generateMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <BackToDashboard />
              <div>
                <Breadcrumbs items={[
                  { label: "Parecer Jurídico", href: "/parecer-juridico" },
                  { label: "Detalhes do Parecer" }
                ]} className="mb-1" />
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                  <Scale className="h-6 w-6 text-primary" />
                  {opinion.title}
                </h1>
                <div className="flex items-center gap-3 mt-2">
                  {getStatusBadge(opinion.status)}
                  {opinion.conclusion && (
                    <div className="flex items-center gap-2">
                      {getConclusionIcon(opinion.conclusion)}
                      <span className="text-sm font-medium">{getConclusionLabel(opinion.conclusion)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {/* Botões de Download */}
              {opinion.opinion && (
                <>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => exportPDFMutation.mutate({ id: opinion.id })}
                    disabled={exportPDFMutation.isPending}
                  >
                    {exportPDFMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    PDF
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => exportDOCXMutation.mutate({ id: opinion.id })}
                    disabled={exportDOCXMutation.isPending}
                  >
                    {exportDOCXMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    DOCX
                  </Button>
                </>
              )}
              {!opinion.opinion && (
                <Button onClick={handleGenerate} disabled={isGenerating}>
                  {isGenerating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Gerando...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Gerar com IA
                    </>
                  )}
                </Button>
              )}
              {opinion.status === "in_review" && (
                <Button onClick={handleApprove} disabled={updateMutation.isPending}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Aprovar
                </Button>
              )}
              {/* Botão Salvar como Template */}
              {opinion.status === "approved" && !opinion.isTemplate && (
                <Button 
                  variant="outline"
                  onClick={() => updateMutation.mutate({ id: opinion.id, isTemplate: true })}
                  disabled={updateMutation.isPending}
                >
                  <BookmarkPlus className="h-4 w-4 mr-2" />
                  Salvar como Template
                </Button>
              )}

              {/* Botão Assinar Digitalmente */}
              {opinion.status === "approved" && opinion.opinion && 
               (!signatureHistoryData || signatureHistoryData.length < opinion.requiredSignatures) && (
                <Button 
                  variant="default"
                  onClick={handleSignClick}
                  disabled={signMutation.isPending}
                >
                  {signMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Shield className="h-4 w-4 mr-2" />
                  )}
                  Assinar Digitalmente
                </Button>
              )}

              {/* Badge de Assinado */}
              {signatureHistoryData && signatureHistoryData.length > 0 && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
                  <ShieldCheck className="h-4 w-4 mr-1" />
                  {signatureHistoryData.length >= opinion.requiredSignatures
                    ? "Totalmente Assinado"
                    : `${signatureHistoryData.length}/${opinion.requiredSignatures} Assinaturas`}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Conteúdo */}
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Coluna Principal */}
          <div className="lg:col-span-2 space-y-6">
            {/* Questão Jurídica */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Questão Jurídica</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-foreground whitespace-pre-wrap">{opinion.legalQuestion}</p>
              </CardContent>
            </Card>

            {/* Contexto */}
            {opinion.context && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Contexto Adicional</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-foreground whitespace-pre-wrap">{opinion.context}</p>
                </CardContent>
              </Card>
            )}

            {/* Parecer Gerado */}
            {opinion.opinion ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Parecer Jurídico
                  </CardTitle>
                  <CardDescription>
                    Análise fundamentada na Lei 14.133/2021
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <Streamdown>{opinion.opinion}</Streamdown>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Sparkles className="h-16 w-16 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium text-muted-foreground mb-2">
                    Parecer ainda não gerado
                  </p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Clique em "Gerar com IA" para criar a análise jurídica
                  </p>
                  <Button onClick={handleGenerate} disabled={isGenerating}>
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Gerando...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4 mr-2" />
                        Gerar com IA
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Coluna Lateral */}
          <div className="space-y-6">
            {/* Informações */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Informações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-start gap-3">
                  <Tag className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Tipo</p>
                    <p className="text-sm text-muted-foreground">{getSourceTypeLabel(opinion.sourceType)}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Solicitado por</p>
                    <p className="text-sm text-muted-foreground">Usuário #{opinion.requestedBy}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm font-medium">Criado em</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(opinion.createdAt).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                </div>
                {opinion.reviewedAt && (
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Revisado em</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(opinion.reviewedAt).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Artigos Citados */}
            {opinion.citedArticles && (opinion.citedArticles as string[]).length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Artigos Citados</CardTitle>
                  <CardDescription>Lei 14.133/2021</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {(opinion.citedArticles as string[]).map((article, index) => (
                      <Badge key={index} variant="outline">
                        {article}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Jurisprudências */}
            {opinion.jurisprudence && Array.isArray(opinion.jurisprudence) && opinion.jurisprudence.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Jurisprudências</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {opinion.jurisprudence.map((juris: any, index: number) => (
                    <div key={index} className="border-l-2 border-primary pl-3">
                      <p className="text-sm font-medium">{juris.court} - {juris.number}</p>
                      <p className="text-xs text-muted-foreground mt-1">{juris.summary}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Card de Informações de Assinatura Digital */}
          {/* Histórico de Assinaturas */}
          {signatureHistoryData && signatureHistoryData.length > 0 && (
            <SignatureHistory
              signatures={signatureHistoryData}
              requiredSignatures={opinion.requiredSignatures}
            />
          )}
        </div>
      </div>

      {/* Modal de Confirmação de Assinatura */}
      <AlertDialog open={showSignDialog} onOpenChange={setShowSignDialog}>
        <AlertDialogContent className="sm:max-w-[550px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Assinar Digitalmente
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-4">
              <p>
                Você está prestes a assinar digitalmente este parecer jurídico.
              </p>

              {/* Seleção de Role */}
              <div className="space-y-2">
                <Label htmlFor="signerRole" className="text-foreground font-medium">
                  Você está assinando como:
                </Label>
                <Select value={signerRole} onValueChange={(value: any) => setSignerRole(value)}>
                  <SelectTrigger id="signerRole">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="revisor">Advogado Revisor</SelectItem>
                    <SelectItem value="responsavel">Advogado Responsável</SelectItem>
                    <SelectItem value="gestor">Gestor Jurídico</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Campo de Senha */}
              <div className="space-y-2">
                <Label htmlFor="signaturePassword" className="text-foreground font-medium">
                  Senha de Assinatura:
                </Label>
                <div className="relative">
                  <Input
                    id="signaturePassword"
                    type={showSignaturePassword ? "text" : "password"}
                    placeholder="Digite sua senha de assinatura"
                    value={signaturePassword}
                    onChange={(e) => setSignaturePassword(e.target.value)}
                    disabled={signMutation.isPending}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowSignaturePassword(!showSignaturePassword)}
                  >
                    {showSignaturePassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="bg-muted p-3 rounded-md space-y-2">
                <p className="text-sm font-medium text-foreground">O que acontece ao assinar?</p>
                <ul className="text-sm space-y-1 list-disc list-inside">
                  <li>Sua identidade será vinculada a este documento</li>
                  <li>Um hash criptográfico SHA-256 será gerado</li>
                  <li>A assinatura será incluída nas exportações PDF/DOCX</li>
                  <li>Esta ação não pode ser desfeita</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSign}
              disabled={signMutation.isPending}
            >
              {signMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Assinando...
                </>
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  Confirmar Assinatura
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Configuração de Senha */}
      <SetSignaturePasswordDialog
        open={showSetPasswordDialog}
        onOpenChange={setShowSetPasswordDialog}
        onSuccess={() => {
          setShowSetPasswordDialog(false);
          setShowSignDialog(true);
        }}
      />
    </div>
  );
}
