import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Download, FileText, FileCheck, Building2 } from "lucide-react";
import { APP_TITLE } from "@/const";

export default function SolicitarProposta() {
  const [step, setStep] = useState<"form" | "success">("form");
  const [proposalId, setProposalId] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const [formData, setFormData] = useState({
    orgaoNome: "",
    orgaoCnpj: "",
    orgaoEndereco: "",
    orgaoCidade: "",
    orgaoEstado: "",
    orgaoCep: "",
    responsavelNome: "",
    responsavelCargo: "",
    responsavelEmail: "",
    responsavelTelefone: "",
    planSlug: "",
    observacoes: "",
  });

  const createProposalMutation = (trpc as any).proposals.create.useMutation();
  const generateDocumentsMutation = (trpc as any).proposals.generateDocuments.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const result = await createProposalMutation.mutateAsync(formData);
      setProposalId(result.proposalId);
      setStep("success");
      toast.success("Proposta criada com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar proposta");
    }
  };

  const handleDownloadDocuments = async () => {
    if (!proposalId) return;

    setIsGenerating(true);
    try {
      const docs = await generateDocumentsMutation.mutateAsync({ proposalId });

      // Download ZIP com proposta + documentos da empresa
      const zipBlob = new Blob(
        [Uint8Array.from(atob(docs.zip), (c) => c.charCodeAt(0))],
        { type: "application/zip" }
      );
      const zipUrl = URL.createObjectURL(zipBlob);
      const zipLink = document.createElement("a");
      zipLink.href = zipUrl;
      zipLink.download = `Proposta_Comercial_${proposalId}.zip`;
      zipLink.click();

      toast.success("Proposta e documentos baixados com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao gerar documentos");
    } finally {
      setIsGenerating(false);
    }
  };

  if (step === "success") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
        <div className="container max-w-4xl mx-auto">
          <Card className="border-2 border-green-200 shadow-xl">
            <CardHeader className="text-center pb-8">
              <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                <FileCheck className="w-8 h-8 text-green-600" />
              </div>
              <CardTitle className="text-3xl text-green-700">Proposta Criada com Sucesso!</CardTitle>
              <CardDescription className="text-lg mt-2">
                Sua solicitação foi registrada. Baixe os documentos abaixo para dar continuidade ao processo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  Documentos Disponíveis
                </h3>
                <div className="space-y-3">
                  <Button
                    onClick={handleDownloadDocuments}
                    disabled={isGenerating}
                    className="w-full justify-start"
                    variant="outline"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Gerando documentos...
                      </>
                    ) : (
                      <>
                        <FileText className="w-4 h-4 mr-2" />
                        Baixar Todos os Documentos
                      </>
                    )}
                  </Button>
                  <p className="text-sm text-muted-foreground">
                    • Proposta Comercial (PDF)<br />
                    • Minuta de Contrato (DOCX)<br />
                    • Termo de Referência (DOCX)<br />
                    • Documentos da Empresa (ZIP)
                  </p>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
                <h3 className="font-semibold text-lg mb-2">Próximos Passos</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
                  <li>Revise os documentos baixados</li>
                  <li>Realize o processo de empenho conforme legislação vigente</li>
                  <li>Após aprovação, entre em contato para ativação da assinatura</li>
                  <li>Aguarde até 48h para liberação do acesso à plataforma</li>
                </ol>
              </div>

              <div className="text-center pt-4">
                <Button onClick={() => window.location.href = "/"} variant="outline">
                  Voltar para o Início
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-12 px-4">
      <div className="container max-w-4xl mx-auto">
        <Card className="shadow-xl">
          <CardHeader className="text-center pb-8">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <Building2 className="w-8 h-8 text-blue-600" />
            </div>
            <CardTitle className="text-3xl">Solicitar Proposta Comercial</CardTitle>
            <CardDescription className="text-lg mt-2">
              Preencha os dados abaixo para receber uma proposta personalizada do {APP_TITLE}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-8">
              {/* Dados do Órgão */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Dados do Órgão</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <Label htmlFor="orgaoNome">Nome do Órgão *</Label>
                    <Input
                      id="orgaoNome"
                      required
                      value={formData.orgaoNome}
                      onChange={(e) => setFormData({ ...formData, orgaoNome: e.target.value })}
                      placeholder="Ex: Prefeitura Municipal de..."
                    />
                  </div>
                  <div>
                    <Label htmlFor="orgaoCnpj">CNPJ *</Label>
                    <Input
                      id="orgaoCnpj"
                      required
                      value={formData.orgaoCnpj}
                      onChange={(e) => setFormData({ ...formData, orgaoCnpj: e.target.value })}
                      placeholder="00.000.000/0000-00"
                    />
                  </div>
                  <div>
                    <Label htmlFor="orgaoCep">CEP *</Label>
                    <Input
                      id="orgaoCep"
                      required
                      value={formData.orgaoCep}
                      onChange={(e) => setFormData({ ...formData, orgaoCep: e.target.value })}
                      placeholder="00000-000"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor="orgaoEndereco">Endereço Completo *</Label>
                    <Input
                      id="orgaoEndereco"
                      required
                      value={formData.orgaoEndereco}
                      onChange={(e) => setFormData({ ...formData, orgaoEndereco: e.target.value })}
                      placeholder="Rua, número, bairro"
                    />
                  </div>
                  <div>
                    <Label htmlFor="orgaoCidade">Cidade *</Label>
                    <Input
                      id="orgaoCidade"
                      required
                      value={formData.orgaoCidade}
                      onChange={(e) => setFormData({ ...formData, orgaoCidade: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="orgaoEstado">Estado (UF) *</Label>
                    <Input
                      id="orgaoEstado"
                      required
                      maxLength={2}
                      value={formData.orgaoEstado}
                      onChange={(e) => setFormData({ ...formData, orgaoEstado: e.target.value.toUpperCase() })}
                      placeholder="Ex: SP"
                    />
                  </div>
                </div>
              </div>

              {/* Dados do Responsável */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Dados do Responsável</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="responsavelNome">Nome Completo *</Label>
                    <Input
                      id="responsavelNome"
                      required
                      value={formData.responsavelNome}
                      onChange={(e) => setFormData({ ...formData, responsavelNome: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="responsavelCargo">Cargo</Label>
                    <Input
                      id="responsavelCargo"
                      value={formData.responsavelCargo}
                      onChange={(e) => setFormData({ ...formData, responsavelCargo: e.target.value })}
                      placeholder="Ex: Pregoeiro"
                    />
                  </div>
                  <div>
                    <Label htmlFor="responsavelEmail">E-mail *</Label>
                    <Input
                      id="responsavelEmail"
                      type="email"
                      required
                      value={formData.responsavelEmail}
                      onChange={(e) => setFormData({ ...formData, responsavelEmail: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="responsavelTelefone">Telefone *</Label>
                    <Input
                      id="responsavelTelefone"
                      required
                      value={formData.responsavelTelefone}
                      onChange={(e) => setFormData({ ...formData, responsavelTelefone: e.target.value })}
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>
              </div>

              {/* Plano Desejado */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Plano Desejado</h3>
                <div>
                  <Label htmlFor="planSlug">Selecione o Plano *</Label>
                  <Select
                    required
                    value={formData.planSlug}
                    onValueChange={(value) => setFormData({ ...formData, planSlug: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha um plano" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="municipal-basico">
                        Municipal Básico - R$ 399/mês (até 15 mil habitantes)
                      </SelectItem>
                      <SelectItem value="municipal-intermediario">
                        Municipal Intermediário - R$ 999/mês (15-50 mil habitantes)
                      </SelectItem>
                      <SelectItem value="municipal-completo">
                        Municipal Completo - R$ 2.499/mês (acima de 50 mil habitantes)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Observações */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Observações (Opcional)</h3>
                <div>
                  <Label htmlFor="observacoes">Informações Adicionais</Label>
                  <Textarea
                    id="observacoes"
                    value={formData.observacoes}
                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                    placeholder="Alguma informação adicional que deseja compartilhar?"
                    rows={4}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-4 pt-4">
                <Button type="button" variant="outline" onClick={() => window.location.href = "/"}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createProposalMutation.isPending}>
                  {createProposalMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Enviando...
                    </>
                  ) : (
                    "Solicitar Proposta"
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
