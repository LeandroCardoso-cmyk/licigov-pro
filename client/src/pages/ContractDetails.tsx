import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ArrowLeft, 
  FileText, 
  Download, 
  Plus, 
  Calendar,
  DollarSign,
  User,
  AlertTriangle,
  History,
  Pencil
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

/**
 * Página de Detalhes do Contrato
 * 5 abas: Visão Geral, Aditivos, Apostilamentos, Documentos, Histórico
 */
export default function ContractDetails() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");

  // Buscar contrato
  const { data: contract, isLoading } = trpc.contracts.getById.useQuery(
    { id: parseInt(id!) },
    { enabled: !!id }
  );

  // Buscar aditivos
  const { data: amendments } = trpc.contracts.amendments.list.useQuery(
    { contractId: parseInt(id!) },
    { enabled: !!id }
  );

  // Buscar apostilamentos
  const { data: apostilles } = trpc.contracts.apostilles.list.useQuery(
    { contractId: parseInt(id!) },
    { enabled: !!id }
  );

  // Buscar documentos
  const { data: documents } = trpc.contracts.documents.list.useQuery(
    { contractId: parseInt(id!) },
    { enabled: !!id }
  );

  // Buscar logs de auditoria
  const { data: auditLogs } = trpc.contracts.audit.getLogs.useQuery(
    { contractId: parseInt(id!) },
    { enabled: !!id }
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Carregando contrato...</p>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Contrato não encontrado</h2>
          <Button onClick={() => setLocation("/contracts")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar para Contratos
          </Button>
        </div>
      </div>
    );
  }

  // Função para obter badge de status
  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string }> = {
      draft: { variant: "secondary", label: "Rascunho" },
      active: { variant: "default", label: "Ativo" },
      suspended: { variant: "outline", label: "Suspenso" },
      terminated: { variant: "destructive", label: "Rescindido" },
      expired: { variant: "destructive", label: "Vencido" },
      completed: { variant: "secondary", label: "Concluído" },
    };
    const config = variants[status] || { variant: "outline" as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  // Calcular dias até vencimento
  const getDaysUntilExpiry = () => {
    const now = new Date();
    const end = new Date(contract.endDate);
    const diffTime = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const daysUntilExpiry = getDaysUntilExpiry();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/contracts")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-3xl font-bold">
                  Contrato nº {contract.number}/{contract.year}
                </h1>
                {getStatusBadge(contract.status)}
              </div>
              <p className="text-muted-foreground">{contract.object}</p>
            </div>
            <Button variant="outline">
              <Pencil className="h-4 w-4 mr-2" />
              Editar
            </Button>
          </div>

          {/* Alerta de Vencimento */}
          {contract.status === "active" && daysUntilExpiry <= 90 && (
            <div className={`p-4 rounded-lg border ${
              daysUntilExpiry < 0
                ? "bg-red-50 border-red-200"
                : daysUntilExpiry <= 30
                ? "bg-red-50 border-red-200"
                : daysUntilExpiry <= 60
                ? "bg-orange-50 border-orange-200"
                : "bg-yellow-50 border-yellow-200"
            }`}>
              <div className="flex items-center gap-2">
                <AlertTriangle className={`h-5 w-5 ${
                  daysUntilExpiry < 0
                    ? "text-red-600"
                    : daysUntilExpiry <= 30
                    ? "text-red-500"
                    : daysUntilExpiry <= 60
                    ? "text-orange-500"
                    : "text-yellow-600"
                }`} />
                <p className={`font-medium ${
                  daysUntilExpiry < 0
                    ? "text-red-800"
                    : daysUntilExpiry <= 30
                    ? "text-red-700"
                    : daysUntilExpiry <= 60
                    ? "text-orange-700"
                    : "text-yellow-800"
                }`}>
                  {daysUntilExpiry < 0
                    ? `Contrato vencido há ${Math.abs(daysUntilExpiry)} dias`
                    : daysUntilExpiry === 0
                    ? "Contrato vence hoje!"
                    : `Contrato vence em ${daysUntilExpiry} dias`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="container py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="amendments">
              Aditivos {amendments && amendments.length > 0 && `(${amendments.length})`}
            </TabsTrigger>
            <TabsTrigger value="apostilles">
              Apostilamentos {apostilles && apostilles.length > 0 && `(${apostilles.length})`}
            </TabsTrigger>
            <TabsTrigger value="documents">
              Documentos {documents && documents.length > 0 && `(${documents.length})`}
            </TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          {/* Aba 1: Visão Geral */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              {/* Dados do Contrato */}
              <Card>
                <CardHeader>
                  <CardTitle>Dados do Contrato</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Tipo</span>
                    <p className="font-medium capitalize">{contract.type}</p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Valor Original</span>
                    <p className="font-medium">
                      {new Intl.NumberFormat('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      }).format(parseFloat(contract.value))}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Valor Atual</span>
                    <p className="font-medium text-lg">
                      {new Intl.NumberFormat('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      }).format(parseFloat(contract.currentValue))}
                    </p>
                  </div>
                  <div>
                    <span className="text-sm text-muted-foreground">Vigência</span>
                    <p className="font-medium">
                      {new Date(contract.startDate).toLocaleDateString('pt-BR')} até{' '}
                      {new Date(contract.endDate).toLocaleDateString('pt-BR')}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {Math.ceil(
                        (new Date(contract.endDate).getTime() - new Date(contract.startDate).getTime()) /
                          (1000 * 60 * 60 * 24)
                      )}{' '}
                      dias
                    </p>
                  </div>
                  {contract.autoRenewal && (
                    <div>
                      <span className="text-sm text-muted-foreground">Renovação Automática</span>
                      <p className="font-medium">
                        Sim (máximo {contract.maxRenewals} renovações)
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Dados do Contratado */}
              <Card>
                <CardHeader>
                  <CardTitle>Contratado</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <span className="text-sm text-muted-foreground">Nome/Razão Social</span>
                    <p className="font-medium">{contract.contractorName}</p>
                  </div>
                  {contract.contractorCNPJ && (
                    <div>
                      <span className="text-sm text-muted-foreground">CNPJ</span>
                      <p className="font-medium">{contract.contractorCNPJ}</p>
                    </div>
                  )}
                  {contract.contractorAddress && (
                    <div>
                      <span className="text-sm text-muted-foreground">Endereço</span>
                      <p className="font-medium">{contract.contractorAddress}</p>
                    </div>
                  )}
                  {contract.contractorContact && (
                    <div>
                      <span className="text-sm text-muted-foreground">Contato</span>
                      <p className="font-medium">{contract.contractorContact}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Fiscal do Contrato */}
              {contract.fiscalUserName && (
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>Fiscalização</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2">
                      <User className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <span className="text-sm text-muted-foreground">Fiscal Responsável</span>
                        <p className="font-medium">{contract.fiscalUserName}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Observações */}
              {contract.notes && (
                <Card className="md:col-span-2">
                  <CardHeader>
                    <CardTitle>Observações</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{contract.notes}</p>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Aba 2: Aditivos */}
          <TabsContent value="amendments" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold">Aditivos Contratuais</h3>
                <p className="text-sm text-muted-foreground">
                  Alterações de prazo, valor ou escopo do contrato
                </p>
              </div>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Novo Aditivo
              </Button>
            </div>

            {amendments && amendments.length > 0 ? (
              <div className="space-y-4">
                {amendments.map((amendment, index) => (
                  <Card key={amendment.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          Aditivo #{amendments.length - index}
                        </CardTitle>
                        <Badge variant="outline" className="capitalize">
                          {amendment.type === "prazo" && "Prazo"}
                          {amendment.type === "valor" && "Valor"}
                          {amendment.type === "escopo" && "Escopo"}
                          {amendment.type === "misto" && "Misto"}
                        </Badge>
                      </div>
                      <CardDescription>
                        {new Date(amendment.createdAt).toLocaleDateString('pt-BR')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <span className="text-sm text-muted-foreground">Justificativa</span>
                        <p className="text-sm">{amendment.justification}</p>
                      </div>
                      {amendment.newEndDate && (
                        <div>
                          <span className="text-sm text-muted-foreground">Nova Data de Término</span>
                          <p className="font-medium">
                            {new Date(amendment.newEndDate).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                      )}
                      {amendment.valueChange && (
                        <div>
                          <span className="text-sm text-muted-foreground">Alteração de Valor</span>
                          <p className="font-medium">
                            {new Intl.NumberFormat('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                              signDisplay: 'always',
                            }).format(parseFloat(amendment.valueChange))}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Nenhum aditivo registrado</h3>
                  <p className="text-muted-foreground mb-4">
                    Adicione aditivos para registrar alterações no contrato
                  </p>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Novo Aditivo
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Aba 3: Apostilamentos */}
          <TabsContent value="apostilles" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold">Apostilamentos</h3>
                <p className="text-sm text-muted-foreground">
                  Reajustes, correções e alterações sem modificar a essência do contrato
                </p>
              </div>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Novo Apostilamento
              </Button>
            </div>

            {apostilles && apostilles.length > 0 ? (
              <div className="space-y-4">
                {apostilles.map((apostille, index) => (
                  <Card key={apostille.id}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          Apostilamento #{apostilles.length - index}
                        </CardTitle>
                        <Badge variant="outline" className="capitalize">
                          {apostille.type === "reajuste" && "Reajuste"}
                          {apostille.type === "correcao" && "Correção"}
                          {apostille.type === "designacao" && "Designação"}
                          {apostille.type === "outro" && "Outro"}
                        </Badge>
                      </div>
                      <CardDescription>
                        {new Date(apostille.createdAt).toLocaleDateString('pt-BR')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <span className="text-sm text-muted-foreground">Descrição</span>
                        <p className="text-sm">{apostille.description}</p>
                      </div>
                      {apostille.newValue && (
                        <div>
                          <span className="text-sm text-muted-foreground">Novo Valor</span>
                          <p className="font-medium">
                            {new Intl.NumberFormat('pt-BR', {
                              style: 'currency',
                              currency: 'BRL',
                            }).format(parseFloat(apostille.newValue))}
                          </p>
                        </div>
                      )}
                      {apostille.adjustmentIndex && (
                        <div>
                          <span className="text-sm text-muted-foreground">Índice de Reajuste</span>
                          <p className="font-medium">{apostille.adjustmentIndex}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">Nenhum apostilamento registrado</h3>
                  <p className="text-muted-foreground mb-4">
                    Adicione apostilamentos para registrar reajustes e correções
                  </p>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Novo Apostilamento
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Aba 4: Documentos */}
          <TabsContent value="documents" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-semibold">Documentos do Contrato</h3>
                <p className="text-sm text-muted-foreground">
                  Gere e gerencie documentos relacionados ao contrato
                </p>
              </div>
            </div>

            {/* Botões de Geração */}
            <div className="grid gap-4 md:grid-cols-2">
              <Button variant="outline" className="h-auto py-4">
                <div className="flex flex-col items-start w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-5 w-5" />
                    <span className="font-semibold">Minuta de Contrato</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Gerar minuta baseada na Lei 14.133/2021
                  </span>
                </div>
              </Button>

              <Button variant="outline" className="h-auto py-4">
                <div className="flex flex-col items-start w-full">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="h-5 w-5" />
                    <span className="font-semibold">Termo de Rescisão</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Gerar termo de rescisão contratual
                  </span>
                </div>
              </Button>
            </div>

            {/* Lista de Documentos */}
            {documents && documents.length > 0 ? (
              <div className="space-y-4">
                <h4 className="font-semibold">Documentos Gerados</h4>
                {documents.map((doc) => (
                  <Card key={doc.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <FileText className="h-8 w-8 text-muted-foreground" />
                          <div>
                            <p className="font-medium capitalize">{doc.type.replace("_", " ")}</p>
                            <p className="text-sm text-muted-foreground">
                              Gerado {formatDistanceToNow(new Date(doc.createdAt), {
                                addSuffix: true,
                                locale: ptBR,
                              })}
                            </p>
                          </div>
                        </div>
                        <Button variant="outline" size="sm">
                          <Download className="h-4 w-4 mr-2" />
                          Download
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    Nenhum documento gerado ainda
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Aba 5: Histórico */}
          <TabsContent value="history" className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">Histórico de Atividades</h3>
              <p className="text-sm text-muted-foreground">
                Timeline completa de todas as ações realizadas neste contrato
              </p>
            </div>

            {auditLogs && auditLogs.length > 0 ? (
              <div className="space-y-4">
                {auditLogs.map((log) => (
                  <Card key={log.id}>
                    <CardContent className="pt-6">
                      <div className="flex items-start gap-3">
                        <History className="h-5 w-5 text-muted-foreground mt-0.5" />
                        <div className="flex-1">
                          <p className="font-medium capitalize">
                            {log.action.replace("_", " ")}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {log.userName} •{' '}
                            {formatDistanceToNow(new Date(log.createdAt), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </p>
                          {log.details && (
                            <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto">
                              {JSON.stringify(JSON.parse(log.details), null, 2)}
                            </pre>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    Nenhuma atividade registrada
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
