import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { FileText, Loader2, Search, CheckCircle, XCircle } from "lucide-react";
import { BackToDashboard } from "@/components/BackToDashboard";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function CommercialManagement() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [selectedProposal, setSelectedProposal] = useState<any>(null);
  const [showEmpenhoDialog, setShowEmpenhoDialog] = useState(false);
  const [empenhoData, setEmpenhoData] = useState({
    numeroEmpenho: "",
    dataEmpenho: "",
    valorEmpenho: "",
    observacoes: "",
  });

  const { data: proposals, isLoading, refetch } = trpc.commercial.listAll.useQuery();
  const registerEmpenhoMutation = trpc.commercial.registerEmpenho.useMutation();
  const activateSubscriptionMutation = trpc.commercial.activateSubscription.useMutation();

  const handleRegisterEmpenho = async () => {
    if (!selectedProposal) return;

    try {
      await registerEmpenhoMutation.mutateAsync({
        proposalId: selectedProposal.id,
        ...empenhoData,
        valorEmpenho: parseFloat(empenhoData.valorEmpenho),
      });
      toast.success("Empenho registrado com sucesso");
      refetch();
      setShowEmpenhoDialog(false);
      setEmpenhoData({ numeroEmpenho: "", dataEmpenho: "", valorEmpenho: "", observacoes: "" });
    } catch (error: any) {
      toast.error(error.message || "Erro ao registrar empenho");
    }
  };

  const handleActivateSubscription = async (proposalId: number) => {
    try {
      await activateSubscriptionMutation.mutateAsync({ proposalId });
      toast.success("Assinatura ativada com sucesso!");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Erro ao ativar assinatura");
    }
  };

  const filteredProposals = proposals?.filter((proposal) => {
    const matchesSearch =
      searchTerm === "" ||
      proposal.orgaoNome.toLowerCase().includes(searchTerm.toLowerCase()) ||
      proposal.responsavelNome.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      filterStatus === "all" || proposal.status === filterStatus;

    return matchesSearch && matchesStatus;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Gestão Comercial</CardTitle>
          <CardDescription>
            Gerencie clientes, contratos e assinaturas do LiciGov Pro
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filtros */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Buscar por órgão ou responsável..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="approved">Aprovado</SelectItem>
                <SelectItem value="rejected">Rejeitado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tabela */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Órgão</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProposals && filteredProposals.length > 0 ? (
                  filteredProposals.map((proposal) => (
                    <TableRow key={proposal.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{proposal.orgaoNome}</div>
                          <div className="text-sm text-muted-foreground">{proposal.orgaoCidade}/{proposal.orgaoEstado}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">{proposal.responsavelNome}</div>
                          <div className="text-sm text-muted-foreground">{proposal.responsavelEmail}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{proposal.planName}</Badge>
                      </TableCell>
                      <TableCell>
                        {proposal.status === "pending" ? (
                          <Badge variant="secondary">Pendente</Badge>
                        ) : proposal.status === "approved" ? (
                          <Badge variant="default" className="bg-green-600">Aprovado</Badge>
                        ) : (
                          <Badge variant="destructive">Rejeitado</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {format(new Date(proposal.createdAt), "dd/MM/yyyy", { locale: ptBR })}
                        </div>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        {proposal.status === "pending" && !proposal.empenhoNumero && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setSelectedProposal(proposal);
                              setShowEmpenhoDialog(true);
                            }}
                          >
                            <FileText className="w-4 h-4 mr-1" />
                            Registrar Empenho
                          </Button>
                        )}
                        {proposal.empenhoNumero && proposal.status === "pending" && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleActivateSubscription(proposal.id)}
                            disabled={activateSubscriptionMutation.isPending}
                          >
                            {activateSubscriptionMutation.isPending ? (
                              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            ) : (
                              <CheckCircle className="w-4 h-4 mr-1" />
                            )}
                            Ativar Assinatura
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Nenhuma proposta encontrada
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog de Registrar Empenho */}
      <Dialog open={showEmpenhoDialog} onOpenChange={setShowEmpenhoDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Registrar Empenho</DialogTitle>
            <DialogDescription>
              Preencha os dados do empenho recebido para ativar a assinatura
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="numeroEmpenho">Número do Empenho *</Label>
                <Input
                  id="numeroEmpenho"
                  value={empenhoData.numeroEmpenho}
                  onChange={(e) => setEmpenhoData({ ...empenhoData, numeroEmpenho: e.target.value })}
                  placeholder="Ex: 2025NE000123"
                />
              </div>
              <div>
                <Label htmlFor="dataEmpenho">Data do Empenho *</Label>
                <Input
                  id="dataEmpenho"
                  type="date"
                  value={empenhoData.dataEmpenho}
                  onChange={(e) => setEmpenhoData({ ...empenhoData, dataEmpenho: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="valorEmpenho">Valor do Empenho (R$) *</Label>
              <Input
                id="valorEmpenho"
                type="number"
                step="0.01"
                value={empenhoData.valorEmpenho}
                onChange={(e) => setEmpenhoData({ ...empenhoData, valorEmpenho: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <Label htmlFor="observacoes">Observações</Label>
              <Textarea
                id="observacoes"
                value={empenhoData.observacoes}
                onChange={(e) => setEmpenhoData({ ...empenhoData, observacoes: e.target.value })}
                placeholder="Informações adicionais sobre o empenho..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEmpenhoDialog(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleRegisterEmpenho}
              disabled={
                !empenhoData.numeroEmpenho ||
                !empenhoData.dataEmpenho ||
                !empenhoData.valorEmpenho ||
                registerEmpenhoMutation.isPending
              }
            >
              {registerEmpenhoMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Registrando...
                </>
              ) : (
                "Registrar Empenho"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
