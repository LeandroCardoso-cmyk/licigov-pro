import { useAuth } from "@/_core/hooks/useAuth";
import { BackToDashboard } from "@/components/BackToDashboard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { 
  Scale, 
  Plus, 
  FileText, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Loader2,
  Eye,
  BookmarkCheck,
  BarChart3
} from "lucide-react";
import { useState, type ReactElement } from "react";
import { useLocation } from "wouter";

export default function LegalOpinions() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>("all");
  const [templateFilter, setTemplateFilter] = useState<string>("all");

  // Buscar pareceres
  const { data: opinions, isLoading } = trpc.legalOpinions.list.useQuery(
    {
      status: statusFilter !== "all" ? (statusFilter as any) : undefined,
      sourceType: sourceTypeFilter !== "all" ? (sourceTypeFilter as any) : undefined,
      isTemplate: templateFilter === "templates" ? true : templateFilter === "regular" ? false : undefined,
    },
    { enabled: !!user }
  );

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
    const icons: Record<string, ReactElement> = {
      favorable: <CheckCircle2 className="h-4 w-4 text-green-600" />,
      unfavorable: <XCircle className="h-4 w-4 text-red-600" />,
      with_reservations: <AlertCircle className="h-4 w-4 text-yellow-600" />,
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
                  { label: "Parecer Jurídico" }
                ]} className="mb-1" />
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                  <Scale className="h-6 w-6 text-primary" />
                  Pareceres Jurídicos
                </h1>
                <p className="text-sm text-muted-foreground">
                  Análises jurídicas automatizadas com IA baseadas na Lei 14.133/2021
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate("/parecer-juridico/analytics")}>
                <BarChart3 className="h-4 w-4 mr-2" />
                Analytics
              </Button>
              <Button onClick={() => navigate("/parecer-juridico/novo")}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Parecer
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <div className="container mx-auto px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filtros</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Status</label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="in_review">Em Revisão</SelectItem>
                    <SelectItem value="approved">Aprovado</SelectItem>
                    <SelectItem value="archived">Arquivado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Tipo de Origem</label>
                <Select value={sourceTypeFilter} onValueChange={setSourceTypeFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="process">Processo Licitatório</SelectItem>
                    <SelectItem value="direct_contract">Contratação Direta</SelectItem>
                    <SelectItem value="contract">Contrato</SelectItem>
                    <SelectItem value="other">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Tipo de Parecer</label>
                <Select value={templateFilter} onValueChange={setTemplateFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="regular">Pareceres Regulares</SelectItem>
                    <SelectItem value="templates">Templates</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista de Pareceres */}
      <div className="container mx-auto px-4 pb-12">
        {!opinions || opinions.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-16 w-16 text-muted-foreground mb-4" />
              <p className="text-lg font-medium text-muted-foreground mb-2">
                Nenhum parecer encontrado
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Crie seu primeiro parecer jurídico com IA
              </p>
              <Button onClick={() => navigate("/parecer-juridico/novo")}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Parecer
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {opinions.map((opinion) => (
              <Card
                key={opinion.id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => navigate(`/parecer-juridico/${opinion.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-lg">{opinion.title}</CardTitle>
                        {opinion.isTemplate && (
                          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
                            <BookmarkCheck className="h-3 w-3 mr-1" />
                            Template
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="line-clamp-2">
                        {opinion.description || opinion.legalQuestion}
                      </CardDescription>
                    </div>
                    <div className="flex flex-col gap-2 items-end">
                      {getStatusBadge(opinion.status)}
                      {opinion.conclusion && (
                        <div className="flex items-center gap-1 text-sm">
                          {getConclusionIcon(opinion.conclusion)}
                          <span>{getConclusionLabel(opinion.conclusion)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <FileText className="h-4 w-4" />
                      {getSourceTypeLabel(opinion.sourceType)}
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {new Date(opinion.createdAt).toLocaleDateString("pt-BR")}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/parecer-juridico/${opinion.id}`);
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Ver Detalhes
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
