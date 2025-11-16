import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Download, Mail, Copy, CheckCircle, Package } from "lucide-react";

interface PresentialPackageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contractId: number;
}

/**
 * Modal para gerar e baixar pacote presencial
 * Inclui: ZIP com documentos + template de email
 */
export function PresentialPackageModal({
  open,
  onOpenChange,
  contractId,
}: PresentialPackageModalProps) {
  const [activeTab, setActiveTab] = useState<"package" | "email">("package");
  const [emailCopied, setEmailCopied] = useState(false);

  // Queries
  const { data: emailTemplate, isLoading: loadingEmail } = trpc.directContracts.presential.getEmailTemplate.useQuery(
    { contractId },
    { enabled: open }
  );

  // Mutations
  const generatePackageMutation = trpc.directContracts.presential.generatePackage.useMutation();

  const handleDownloadPackage = async () => {
    try {
      const result = await generatePackageMutation.mutateAsync({
        contractId,
        includeDocuments: true,
        includeQuotations: true,
        includeReadme: true,
      });

      // Converter base64 para blob e fazer download
      const byteCharacters = atob(result.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: "application/zip" });

      // Criar link de download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success("Pacote baixado com sucesso!");
    } catch (error: any) {
      toast.error(error.message || "Erro ao gerar pacote");
    }
  };

  const handleCopyEmail = () => {
    if (!emailTemplate) return;

    const fullEmail = `Assunto: ${emailTemplate.subject}\n\n${emailTemplate.body}`;
    navigator.clipboard.writeText(fullEmail);
    setEmailCopied(true);
    toast.success("Email copiado para a área de transferência!");

    setTimeout(() => setEmailCopied(false), 3000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5" />
            Pacote Presencial
          </DialogTitle>
          <DialogDescription>
            Baixe o pacote completo com todos os documentos e envie para o fornecedor
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v: any) => setActiveTab(v)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="package">
              <Download className="w-4 h-4 mr-2" />
              Pacote ZIP
            </TabsTrigger>
            <TabsTrigger value="email">
              <Mail className="w-4 h-4 mr-2" />
              Template de Email
            </TabsTrigger>
          </TabsList>

          {/* Aba: Pacote ZIP */}
          <TabsContent value="package" className="space-y-4">
            <Alert>
              <Package className="w-4 h-4" />
              <AlertDescription>
                O pacote ZIP contém todos os documentos necessários para a contratação presencial.
              </AlertDescription>
            </Alert>

            <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg space-y-4">
              <h3 className="font-semibold text-lg mb-4">Conteúdo do Pacote:</h3>

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-medium">📁 Pasta "documentos/"</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Termo de Dispensa/Inexigibilidade, Minuta de Contrato, Planilha de Cotação, Mapa Comparativo
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-medium">📊 PLANILHA_COTACOES.xlsx</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Planilha Excel formatada com comparativo de cotações e estatísticas
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                  <div>
                    <p className="font-medium">📄 LEIA-ME.txt</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Instruções completas de uso, documentos obrigatórios e observações legais
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
              <AlertDescription>
                <strong>Importante:</strong> Certifique-se de que todos os documentos foram gerados antes de baixar o pacote.
              </AlertDescription>
            </Alert>

            <Button
              onClick={handleDownloadPackage}
              disabled={generatePackageMutation.isPending}
              className="w-full"
              size="lg"
            >
              {generatePackageMutation.isPending ? (
                <>Gerando Pacote...</>
              ) : (
                <>
                  <Download className="w-5 h-5 mr-2" />
                  Baixar Pacote Completo (ZIP)
                </>
              )}
            </Button>
          </TabsContent>

          {/* Aba: Template de Email */}
          <TabsContent value="email" className="space-y-4">
            <Alert>
              <Mail className="w-4 h-4" />
              <AlertDescription>
                Use este template para solicitar cotação de preços ao fornecedor.
              </AlertDescription>
            </Alert>

            {loadingEmail ? (
              <div className="text-center py-8">
                <p className="text-gray-600 dark:text-gray-400">Carregando template...</p>
              </div>
            ) : emailTemplate ? (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Assunto:</label>
                    <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">
                      <p className="font-medium">{emailTemplate.subject}</p>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-2">Corpo do Email:</label>
                    <Textarea
                      value={emailTemplate.body}
                      readOnly
                      rows={20}
                      className="font-mono text-sm"
                    />
                  </div>
                </div>

                <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
                  <AlertDescription>
                    <strong>Dica:</strong> Copie o template e cole no seu cliente de email. Lembre-se de anexar o pacote ZIP e preencher os campos marcados com [INSERIR...].
                  </AlertDescription>
                </Alert>

                <Button
                  onClick={handleCopyEmail}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  {emailCopied ? (
                    <>
                      <CheckCircle className="w-5 h-5 mr-2 text-green-600" />
                      Email Copiado!
                    </>
                  ) : (
                    <>
                      <Copy className="w-5 h-5 mr-2" />
                      Copiar Template de Email
                    </>
                  )}
                </Button>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-600 dark:text-gray-400">Erro ao carregar template</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
