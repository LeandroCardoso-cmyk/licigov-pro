import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, FileText, Shield } from "lucide-react";

interface ConsentModalProps {
  open: boolean;
  onConsent: () => void;
}

export function ConsentModal({ open, onConsent }: ConsentModalProps) {
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);

  const acceptConsentMutation = trpc.lgpd.acceptConsent.useMutation({
    onSuccess: () => {
      toast.success("Consentimento registrado com sucesso!");
      onConsent();
    },
    onError: (error) => {
      toast.error("Erro ao registrar consentimento", { description: error.message });
    },
  });

  const handleAccept = () => {
    if (!acceptedTerms || !acceptedPrivacy) {
      toast.error("Você precisa aceitar os Termos de Uso e a Política de Privacidade para continuar");
      return;
    }

    acceptConsentMutation.mutate({
      termsVersion: "1.0",
      privacyVersion: "1.0",
      ipAddress: "", // Será preenchido no backend
      userAgent: navigator.userAgent,
    });
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-2xl max-h-[90vh]" onInteractOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Shield className="h-5 w-5 text-primary" />
            Bem-vindo ao LiciGov Pro
          </DialogTitle>
          <DialogDescription>
            Antes de continuar, precisamos do seu consentimento para processar seus dados pessoais de acordo com a LGPD.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Termos de Uso
              </h3>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Ao usar o LiciGov Pro, você concorda em:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Usar o serviço apenas para fins legais e de acordo com a legislação brasileira</li>
                  <li>Manter a confidencialidade de sua conta e senha</li>
                  <li>Não compartilhar conteúdo ilegal, ofensivo ou que viole direitos de terceiros</li>
                  <li>Revisar documentos gerados pela IA antes do uso oficial</li>
                  <li>Respeitar os direitos de propriedade intelectual</li>
                </ul>
                <p className="mt-3">
                  <a href="/termos" target="_blank" className="text-primary hover:underline">
                    Leia os Termos de Uso completos →
                  </a>
                </p>
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <h3 className="font-semibold flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Política de Privacidade e LGPD
              </h3>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Coletamos e processamos seus dados pessoais para:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Fornecer o serviço:</strong> Nome, email, processos e documentos criados</li>
                  <li><strong>Melhorar a experiência:</strong> Histórico de uso e preferências</li>
                  <li><strong>Segurança:</strong> Logs de acesso e auditoria</li>
                  <li><strong>Comunicação:</strong> Notificações sobre atividades relevantes</li>
                </ul>
                <p className="mt-3">
                  <strong>Seus direitos sob a LGPD:</strong>
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Acessar seus dados pessoais</li>
                  <li>Corrigir dados incompletos ou inexatos</li>
                  <li>Solicitar a exclusão de seus dados (direito ao esquecimento)</li>
                  <li>Exportar seus dados (portabilidade)</li>
                  <li>Revogar seu consentimento a qualquer momento</li>
                </ul>
                <p className="mt-3">
                  <a href="/privacidade" target="_blank" className="text-primary hover:underline">
                    Leia a Política de Privacidade completa →
                  </a>
                </p>
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <h3 className="font-semibold">Base Legal para Processamento</h3>
              <div className="text-sm text-muted-foreground">
                <p>
                  Processamos seus dados com base em:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  <li><strong>Consentimento:</strong> Você nos autoriza explicitamente</li>
                  <li><strong>Execução de contrato:</strong> Necessário para fornecer o serviço</li>
                  <li><strong>Obrigação legal:</strong> Cumprimento de requisitos legais</li>
                  <li><strong>Legítimo interesse:</strong> Melhorias e segurança do serviço</li>
                </ul>
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="space-y-4 pt-4 border-t">
          <div className="flex items-start space-x-3">
            <Checkbox
              id="terms"
              checked={acceptedTerms}
              onCheckedChange={(checked) => setAcceptedTerms(checked as boolean)}
            />
            <label
              htmlFor="terms"
              className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Li e aceito os <a href="/termos" target="_blank" className="text-primary hover:underline">Termos de Uso</a>
            </label>
          </div>

          <div className="flex items-start space-x-3">
            <Checkbox
              id="privacy"
              checked={acceptedPrivacy}
              onCheckedChange={(checked) => setAcceptedPrivacy(checked as boolean)}
            />
            <label
              htmlFor="privacy"
              className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
            >
              Li e aceito a <a href="/privacidade" target="_blank" className="text-primary hover:underline">Política de Privacidade</a> e autorizo o processamento dos meus dados pessoais conforme descrito
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleAccept}
            disabled={!acceptedTerms || !acceptedPrivacy || acceptConsentMutation.isPending}
            className="w-full"
          >
            {acceptConsentMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Registrando...
              </>
            ) : (
              "Aceitar e Continuar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
