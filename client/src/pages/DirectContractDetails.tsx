import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileText,
  Download,
  Plus,
  Trash2,
  CheckCircle,
  Clock,
  AlertCircle,
  Package,
  DollarSign,
  Calendar,
  User,
  Building,
  FileCheck,
  Scale,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { PresentialPackageModal } from "@/components/PresentialPackageModal";
import { ChecklistTab } from "@/components/ChecklistTab";
import { AuditTimeline } from "@/components/AuditTimeline";

/**
 * Página de Detalhes da Contratação Direta
 * Timeline, documentos, cotações, fornecedor
 */
export default function DirectContractDetails() {
  const [, params] = useRoute("/direct-contracts/:id");
  const [, setLocation] = useLocation();
  const contractId = params?.id ? parseInt(params.id) : 0;

  const [showQuotationDialog, setShowQuotationDialog] = useState(false);
  const [showPresentialPackage, setShowPresentialPackage] = useState(false);
  const [quotationSupplier, setQuotationSupplier] = useState("");
  const [quotationValue, setQuotationValue] = useState("");
  const [quotationDate, setQuotationDate] = useState("");

  // Queries
  const { data: contract, isLoading } = trpc.directContracts.getById.useQuery({ id: contractId });
  const { data: documents } = trpc.directContracts.documents.list.useQuery({ directContractId: contractId });
  const { data: quotations } = trpc.directContracts.quotations.list.useQuery({ directContractId: contractId });

  // Mutations
  const generateDocMutation = (trpc as any).directContracts.documents.generate.useMutation();
  const addQuotationMutation = (trpc as any).directContracts.quotations.add.useMutation();
  const deleteQuotationMutation = (trpc as any).directContracts.quotations.delete.useMutation();
  const utils = trpc.useUtils();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Carregando...</p>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">Contratação não encontrada</p>
          <Button onClick={() => setLocation("/direct-contracts")}>
            Voltar para Lista
          </Button>
        </div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; label: string; icon: any }> = {
      draft: { variant: "secondary", label: "Rascunho", icon: Clock },
      approved: { variant: "default", label: "Aprovado", icon: CheckCircle },
      published: { variant: "outline", label: "Publicado", icon: FileText },
    };

    const config = variants[status] || variants.draft;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  const getTypeBadge = (type: string) => {
    return type === "dispensa" ? (
      <Badge variant="default" className="bg-blue-500">
        Dispensa
      </Badge>
    ) : (
      <Badge variant="default" className="bg-purple-500">
        Inexigibilidade
      </Badge>
    );
  };

  const handleGenerateDocument = async (type: string) => {
    try {
      await generateDocMutation.mutateAsync({ directContractId: contractId, type });
      toast.success("Documento gerado com sucesso!");
      utils.directContracts.documents.list.invalidate({ directContractId: contractId });
    } catch (error: any) {
      toast.error(error.message || "Erro ao gerar documento");
    }
  };

  const handleAddQuotation = async () => {
    if (!quotationSupplier || !quotationValue || !quotationDate) {
      toast.error("Preencha todos os campos");
      return;
    }

    try {
      await addQuotationMutation.mutateAsync({
        directContractId: contractId,
        supplierName: quotationSupplier,
        value: parseFloat(quotationValue) * 100,
      });

      toast.success("Cotação adicionada!");
      setShowQuotationDialog(false);
      setQuotationSupplier("");
      setQuotationValue("");
      setQuotationDate("");
      utils.directContracts.quotations.list.invalidate({ directContractId: contractId });
    } catch (error: any) {
      toast.error(error.message || "Erro ao adicionar cotação");
    }
  };

  const handleDeleteQuotation = async (quotationId: number) => {
    if (!confirm("Deseja realmente excluir esta cotação?")) return;

    try {
      await deleteQuotationMutation.mutateAsync({ id: quotationId });
      toast.success("Cotação excluída!");
      utils.directContracts.quotations.list.invalidate({ directContractId: contractId });
    } catch (error: any) {
      toast.error(error.message || "Erro ao excluir cotação");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => setLocation("/direct-contracts")}
            className="mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>

          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 mb-2">
                {getTypeBadge(contract.type)}
                {getStatusBadge(contract.status)}
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Nº {contract.number}/{contract.year}
                </span>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
                {contract.object}
              </h1>
              <p className="text-gray-600 dark:text-gray-400">
                {contract.legalArticle?.article} {contract.legalArticle?.inciso || ""}
              </p>
            </div>
            <div className="text-right space-y-3">
              <div className="text-3xl font-bold text-green-600">
                R$ {(contract.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Criado em {format(new Date(contract.createdAt), "dd/MM/yyyy", { locale: ptBR })}
              </p>
              <div className="flex gap-2">
                {/* Botão Solicitar Parecer Jurídico */}
                <Button
                  onClick={() => setLocation(`/parecer-juridico/novo?contractId=${contract.id}&type=contratacao_direta`)}
                  variant="outline"
                  size="sm"
                >
                  <Scale className="w-4 h-4 mr-2" />
                  Solicitar Parecer
                </Button>
                {contract.mode === "presencial" && (
                  <Button
                    onClick={() => setShowPresentialPackage(true)}
                    variant="default"
                    size="sm"
                  >
                    <Package className="w-4 h-4 mr-2" />
                    Preparar Pacote Presencial
                  </Button>
                )}
                <Button
                  onClick={() => {
                    const params = new URLSearchParams({
                      source: 'direct',
                      directContractId: contract.id.toString(),
                      number: contract.number,
                      object: contract.object,
                      contractedName: contract.supplierName || '',
                      contractedCnpj: contract.supplierCNPJ || '',
                      value: (contract.value / 100).toString(),
                    });
                    setLocation(`/contracts/new?${params.toString()}`);
                  }}
                  variant="outline"
                  size="sm"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Gerar Contrato
                </Button>
              </div>
            </div>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="documents">Documentos</TabsTrigger>
            <TabsTrigger value="quotations">Cotações</TabsTrigger>
            {contract.platformId && (
              <TabsTrigger value="checklist">Checklist da Plataforma</TabsTrigger>
            )}
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          {/* Aba: Visão Geral */}
          <TabsContent value="overview" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Dados da Contratação */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="w-5 h-5" />
                    Dados da Contratação
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-gray-600 dark:text-gray-400">Objeto</Label>
                    <p className="font-medium">{contract.object}</p>
                  </div>
                  <Separator />
                  <div>
                    <Label className="text-gray-600 dark:text-gray-400">Justificativa</Label>
                    <p className="text-sm">{contract.justification}</p>
                  </div>
                  <Separator />
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-gray-600 dark:text-gray-400">Valor</Label>
                      <p className="font-medium text-green-600">
                        R$ {(contract.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    {contract.executionDeadline && (
                      <div>
                        <Label className="text-gray-600 dark:text-gray-400">Prazo</Label>
                        <p className="font-medium">{contract.executionDeadline} dias</p>
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div>
                    <Label className="text-gray-600 dark:text-gray-400">Modo</Label>
                    <p className="font-medium">
                      {contract.mode === "presencial" ? "Presencial (ZIP + Email)" : "Eletrônico (Plataforma)"}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Fornecedor */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5" />
                    Fornecedor
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {contract.supplierName ? (
                    <>
                      <div>
                        <Label className="text-gray-600 dark:text-gray-400">Nome</Label>
                        <p className="font-medium">{contract.supplierName}</p>
                      </div>
                      {contract.supplierCNPJ && (
                        <>
                          <Separator />
                          <div>
                            <Label className="text-gray-600 dark:text-gray-400">CNPJ</Label>
                            <p className="font-medium">{contract.supplierCNPJ}</p>
                          </div>
                        </>
                      )}
                      {contract.supplierAddress && (
                        <>
                          <Separator />
                          <div>
                            <Label className="text-gray-600 dark:text-gray-400">Endereço</Label>
                            <p className="text-sm">{contract.supplierAddress}</p>
                          </div>
                        </>
                      )}
                      {contract.supplierContact && (
                        <>
                          <Separator />
                          <div>
                            <Label className="text-gray-600 dark:text-gray-400">Contato</Label>
                            <p className="text-sm">{contract.supplierContact}</p>
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <p className="text-gray-600 dark:text-gray-400 text-center py-8">
                      Fornecedor não informado
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Enquadramento Legal */}
              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileCheck className="w-5 h-5" />
                    Enquadramento Legal
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label className="text-gray-600 dark:text-gray-400">Artigo Legal</Label>
                    <p className="font-medium">
                      {contract.legalArticle?.article} {contract.legalArticle?.inciso || ""}
                    </p>
                  </div>
                  <Separator />
                  <div>
                    <Label className="text-gray-600 dark:text-gray-400">Descrição</Label>
                    <p className="text-sm">{contract.legalArticle?.description}</p>
                  </div>
                  {!!(contract.legalArticle?.examples) && (
                    <>
                      <Separator />
                      <div>
                        <Label className="text-gray-600 dark:text-gray-400">Exemplos de Aplicação</Label>
                        <p className="text-sm">{String(contract.legalArticle!.examples)}</p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Aba: Documentos */}
          <TabsContent value="documents" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Documentos Gerados</CardTitle>
                    <CardDescription>
                      Gere e baixe os documentos necessários para a contratação
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <Button
                    variant="outline"
                    onClick={() => handleGenerateDocument(contract.type === "dispensa" ? "termo_dispensa" : "termo_inexigibilidade")}
                    disabled={generateDocMutation.isPending}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Gerar {contract.type === "dispensa" ? "Termo de Dispensa" : "Termo de Inexigibilidade"}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => handleGenerateDocument("minuta_contrato")}
                    disabled={generateDocMutation.isPending}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Gerar Minuta de Contrato
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => handleGenerateDocument("planilha_cotacao")}
                    disabled={generateDocMutation.isPending}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Gerar Planilha de Cotação
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => handleGenerateDocument("mapa_comparativo")}
                    disabled={generateDocMutation.isPending}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Gerar Mapa Comparativo
                  </Button>
                </div>

                <Separator className="my-6" />

                {documents && documents.length > 0 ? (
                  <div className="space-y-2">
                    {documents.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-blue-600" />
                          <div>
                            <p className="font-medium">{doc.type.replace(/_/g, " ").toUpperCase()}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              Gerado em {format(new Date(doc.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </p>
                          </div>
                        </div>
                        <Button variant="ghost" size="sm">
                          <Download className="w-4 h-4 mr-2" />
                          Baixar
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-gray-600 dark:text-gray-400 py-8">
                    Nenhum documento gerado ainda
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba: Cotações */}
          <TabsContent value="quotations" className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Cotações de Preços</CardTitle>
                    <CardDescription>
                      Registre as cotações recebidas para comparação
                    </CardDescription>
                  </div>
                  <Button onClick={() => setShowQuotationDialog(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Adicionar Cotação
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {quotations && quotations.length > 0 ? (
                  <div className="space-y-2">
                    {quotations.map((quotation) => (
                      <div
                        key={quotation.id}
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <DollarSign className="w-5 h-5 text-green-600" />
                          <div>
                            <p className="font-medium">{quotation.supplierName}</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400">
                              {format(new Date(quotation.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xl font-bold text-green-600">
                            R$ {(quotation.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteQuotation(quotation.id)}
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-gray-600 dark:text-gray-400 py-8">
                    Nenhuma cotação registrada ainda
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba: Checklist da Plataforma */}
          {contract.platformId && (
            <TabsContent value="checklist" className="space-y-6">
              <ChecklistTab contractId={contractId} platformId={contract.platformId} />
            </TabsContent>
          )}

          {/* Aba: Histórico */}
          <TabsContent value="history" className="space-y-6">
            <AuditTimeline contractId={contractId} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialog: Adicionar Cotação */}
      <Dialog open={showQuotationDialog} onOpenChange={setShowQuotationDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Cotação</DialogTitle>
            <DialogDescription>
              Registre uma nova cotação de preços
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="quotationSupplier">Fornecedor *</Label>
              <Input
                id="quotationSupplier"
                value={quotationSupplier}
                onChange={(e) => setQuotationSupplier(e.target.value)}
                placeholder="Nome do fornecedor"
              />
            </div>
            <div>
              <Label htmlFor="quotationValue">Valor (R$) *</Label>
              <Input
                id="quotationValue"
                type="number"
                value={quotationValue}
                onChange={(e) => setQuotationValue(e.target.value)}
                placeholder="Ex: 15000.00"
                step="0.01"
              />
            </div>
            <div>
              <Label htmlFor="quotationDate">Data da Cotação *</Label>
              <Input
                id="quotationDate"
                type="date"
                value={quotationDate}
                onChange={(e) => setQuotationDate(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowQuotationDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAddQuotation} disabled={addQuotationMutation.isPending}>
                {addQuotationMutation.isPending ? "Adicionando..." : "Adicionar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Pacote Presencial */}
      <PresentialPackageModal
        open={showPresentialPackage}
        onOpenChange={setShowPresentialPackage}
        contractId={contractId}
      />
    </div>
  );
}
