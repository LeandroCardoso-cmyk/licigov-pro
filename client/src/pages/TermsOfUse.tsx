import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function TermsOfUse() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <Button variant="ghost" onClick={() => setLocation("/configuracoes")} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Termos de Uso</CardTitle>
            <p className="text-sm text-muted-foreground">Última atualização: Janeiro de 2025 • Versão 1.0</p>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none">
            <h2>1. Aceitação dos Termos</h2>
            <p>
              Ao acessar e usar o LiciGov Pro, você concorda em cumprir e estar vinculado aos seguintes termos e condições de uso. Se você não concordar com qualquer parte destes termos, não deverá usar nosso serviço.
            </p>

            <h2>2. Descrição do Serviço</h2>
            <p>
              O LiciGov Pro é uma plataforma de automação de processos licitatórios que utiliza inteligência artificial para gerar documentos técnicos (ETP, TR, DFD e Editais) baseados na Lei 14.133/21.
            </p>

            <h2>3. Cadastro e Conta</h2>
            <p>
              Para utilizar o serviço, você deve criar uma conta fornecendo informações precisas e completas. Você é responsável por manter a confidencialidade de sua conta e senha e por todas as atividades que ocorram em sua conta.
            </p>

            <h2>4. Uso Aceitável</h2>
            <p>Você concorda em usar o serviço apenas para fins legais e de acordo com estes Termos. Você não deve:</p>
            <ul>
              <li>Usar o serviço de qualquer maneira que viole leis ou regulamentos aplicáveis</li>
              <li>Tentar obter acesso não autorizado ao serviço ou sistemas relacionados</li>
              <li>Interferir ou interromper a integridade ou desempenho do serviço</li>
              <li>Transmitir vírus, malware ou qualquer código malicioso</li>
              <li>Coletar ou armazenar dados pessoais de outros usuários sem consentimento</li>
            </ul>

            <h2>5. Propriedade Intelectual</h2>
            <p>
              O serviço e seu conteúdo original, recursos e funcionalidades são e permanecerão propriedade exclusiva do LiciGov Pro. Os documentos gerados através do serviço são de propriedade do usuário que os criou.
            </p>

            <h2>6. Limitação de Responsabilidade</h2>
            <p>
              O LiciGov Pro não se responsabiliza por quaisquer danos diretos, indiretos, incidentais, especiais ou consequenciais resultantes do uso ou incapacidade de usar o serviço. Os documentos gerados pela IA devem ser revisados por profissionais qualificados antes do uso oficial.
            </p>

            <h2>7. Modificações do Serviço</h2>
            <p>
              Reservamo-nos o direito de modificar ou descontinuar, temporária ou permanentemente, o serviço com ou sem aviso prévio. Não seremos responsáveis perante você ou terceiros por qualquer modificação, suspensão ou descontinuação do serviço.
            </p>

            <h2>8. Rescisão</h2>
            <p>
              Podemos encerrar ou suspender sua conta imediatamente, sem aviso prévio ou responsabilidade, por qualquer motivo, incluindo, sem limitação, se você violar os Termos.
            </p>

            <h2>9. Lei Aplicável</h2>
            <p>
              Estes Termos serão regidos e interpretados de acordo com as leis do Brasil, sem considerar suas disposições sobre conflitos de leis.
            </p>

            <h2>10. Alterações nos Termos</h2>
            <p>
              Reservamo-nos o direito de modificar ou substituir estes Termos a qualquer momento. Se uma revisão for material, tentaremos fornecer um aviso com pelo menos 30 dias de antecedência.
            </p>

            <h2>11. Contato</h2>
            <p>
              Se você tiver alguma dúvida sobre estes Termos, entre em contato conosco através do sistema de suporte.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
