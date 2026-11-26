import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, FileCheck, Building2 } from "lucide-react";
import { APP_TITLE } from "@/const";

/** COM-01 — mensagem de erro legível (o erro de validação do schema chega como JSON técnico). */
function proposalErrorMessage(error: unknown): string {
  const data = (error as { data?: { code?: string; zodError?: unknown } } | null)?.data;
  const message = error instanceof Error ? error.message : "";
  if (data?.code === "TOO_MANY_REQUESTS") return "Muitas solicitações em pouco tempo. Aguarde alguns minutos e tente novamente.";
  if (data?.zodError || message.trim().startsWith("[")) {
    return "Verifique os campos obrigatórios: UF com 2 letras, CEP com 8 dígitos, telefone com DDD e e-mail válido.";
  }
  return message || "Não foi possível enviar a solicitação. Tente novamente.";
}

export default function SolicitarProposta() {
  const [step, setStep] = useState<"form" | "success">("form");

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
    observacoes: "",
    // Honeypot anti-bot: nunca visível/preenchível por um usuário humano (ver estilo abaixo).
    website: "",
  });

  const createProposalMutation = trpc.commercial.create.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // COM-01 — sucesso SÓ depois da persistência confirmada pelo servidor; erro de validação vira orientação legível.
    try {
      await createProposalMutation.mutateAsync(formData);
      setStep("success");
      toast.success("Solicitação recebida.");
    } catch (error) {
      toast.error(proposalErrorMessage(error));
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
              <CardTitle className="text-3xl text-green-700">Solicitação recebida</CardTitle>
              <CardDescription className="text-lg mt-2" data-testid="proposal-success-message">
                Solicitação recebida. Nossa equipe entrará em contato para apresentar a plataforma e esclarecer as
                condições comerciais. A eventual contratação observará os procedimentos legais aplicáveis ao órgão.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-sm text-muted-foreground">
                Esta solicitação é uma manifestação de interesse: não gera obrigação contratual, decisão administrativa
                nem compromisso de aquisição para o órgão.
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
            <CardTitle className="text-3xl">Solicitar demonstração e proposta</CardTitle>
            <CardDescription className="text-lg mt-2">
              Informe os dados do órgão para que nossa equipe apresente o {APP_TITLE} e esclareça as condições
              comerciais. O envio não gera obrigação nem compromisso de aquisição.
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

              {/* Observações */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold border-b pb-2">Necessidades do órgão (opcional)</h3>
                <div>
                  <Label htmlFor="observacoes">Informações Adicionais</Label>
                  <Textarea
                    id="observacoes"
                    value={formData.observacoes}
                    onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                    placeholder="Ex.: número estimado de usuários, módulos de interesse (licitações, contratos, contratação direta), melhor horário para contato."
                    rows={4}
                  />
                </div>
              </div>

              {/* Honeypot anti-bot: campo invisível a usuários humanos (fora da tela e do
                  fluxo de tab); bots de preenchimento automático costumam preenchê-lo. */}
              <div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
                <Label htmlFor="website">Não preencher este campo</Label>
                <Input
                  id="website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                />
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
