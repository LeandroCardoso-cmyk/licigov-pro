import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";

export default function PrivacyPolicy() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <Button variant="ghost" onClick={() => (window.history.length > 1 ? window.history.back() : setLocation("/"))} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Política de Privacidade</CardTitle>
            <p className="text-sm text-muted-foreground">Última atualização: Janeiro de 2025 • Versão 1.0 — com correções factuais de novembro de 2026</p>
            {/* PRD-03 (LICIGOV-LAUNCH-READY) — só correções factuais (login próprio, localização dos provedores, medidas de
                segurança verificáveis, provedores). A versão institucional completa é minuta em revisão
                (docs/legal/PRIVACY_TERMS_LAUNCH_READY_DRAFT.md) e só substitui este texto após aprovação humana competente. */}
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none">
            <h2>1. Introdução</h2>
            <p>
              Esta Política de Privacidade descreve como o LiciGov Pro coleta, usa e protege suas informações pessoais com base na Lei Geral de Proteção de Dados (LGPD - Lei 13.709/2018).
            </p>

            <h2>2. Informações que Coletamos</h2>
            <h3>2.1 Informações de Cadastro</h3>
            <ul>
              <li>Nome completo</li>
              <li>Endereço de e-mail</li>
              <li>Credenciais de acesso (e-mail e senha; a senha é armazenada apenas como hash, não reversível)</li>
              <li>Data e hora de acesso</li>
            </ul>

            <h3>2.2 Informações de Uso</h3>
            <ul>
              <li>Processos licitatórios criados</li>
              <li>Documentos gerados (ETP, TR, DFD, Editais)</li>
              <li>Histórico de atividades</li>
              <li>Comentários e colaborações</li>
              <li>Logs de sistema e auditoria</li>
            </ul>

            <h3>2.3 Informações Técnicas</h3>
            <ul>
              <li>Endereço IP</li>
              <li>Tipo de navegador</li>
              <li>Sistema operacional</li>
              <li>Cookies e tecnologias similares</li>
            </ul>

            <h2>3. Como Usamos Suas Informações</h2>
            <p>Utilizamos suas informações pessoais para:</p>
            <ul>
              <li>Fornecer e manter nosso serviço</li>
              <li>Processar solicitações de geração de documentos</li>
              <li>Enviar notificações sobre atividades relevantes</li>
              <li>Melhorar e personalizar sua experiência</li>
              <li>Detectar e prevenir fraudes e abusos</li>
              <li>Cumprir obrigações legais</li>
            </ul>

            <h2>4. Base Legal para Processamento (LGPD)</h2>
            <p>Processamos seus dados pessoais com base em:</p>
            <ul>
              <li><strong>Consentimento:</strong> Você nos deu permissão explícita para processar seus dados</li>
              <li><strong>Execução de contrato:</strong> Necessário para fornecer o serviço contratado</li>
              <li><strong>Obrigação legal:</strong> Cumprimento de requisitos legais e regulatórios</li>
              <li><strong>Legítimo interesse:</strong> Melhorias do serviço e segurança</li>
            </ul>

            <h2>5. Compartilhamento de Informações</h2>
            <p>
              Não vendemos, alugamos ou compartilhamos suas informações pessoais com terceiros, exceto:
            </p>
            <ul>
              <li>Com seu consentimento explícito</li>
              <li>Para cumprir obrigações legais</li>
              <li>Com provedores de serviços essenciais à operação da plataforma — hospedagem e banco de dados, armazenamento de arquivos, envio de e-mails transacionais, processamento de pagamentos e provedores de inteligência artificial utilizados na geração assistida de conteúdo</li>
              <li>Em caso de fusão, aquisição ou venda de ativos</li>
            </ul>

            <h2>6. Segurança de Dados</h2>
            <p>
              Implementamos medidas técnicas e organizacionais apropriadas para proteger seus dados pessoais contra acesso não autorizado, alteração, divulgação ou destruição, incluindo:
            </p>
            <ul>
              <li>Comunicação criptografada (HTTPS) entre o navegador e a plataforma</li>
              <li>Senhas armazenadas apenas como hash</li>
              <li>Controles de acesso baseados em funções e isolamento dos dados de cada órgão</li>
              <li>Registros de auditoria das operações relevantes</li>
              <li>Cópias de segurança periódicas do banco de dados</li>
            </ul>

            <h2>7. Seus Direitos sob a LGPD</h2>
            <p>Você tem os seguintes direitos em relação aos seus dados pessoais:</p>
            <ul>
              <li><strong>Acesso:</strong> Confirmar se processamos seus dados e solicitar uma cópia</li>
              <li><strong>Correção:</strong> Solicitar correção de dados incompletos, inexatos ou desatualizados</li>
              <li><strong>Anonimização, bloqueio ou eliminação:</strong> Solicitar a exclusão de dados desnecessários ou tratados em desconformidade</li>
              <li><strong>Portabilidade:</strong> Solicitar a transferência de seus dados para outro fornecedor</li>
              <li><strong>Revogação do consentimento:</strong> Retirar seu consentimento a qualquer momento</li>
              <li><strong>Oposição:</strong> Opor-se ao tratamento de dados em certas circunstâncias</li>
            </ul>

            <h2>8. Retenção de Dados</h2>
            <p>
              Retemos suas informações pessoais apenas pelo tempo necessário para cumprir os propósitos descritos nesta Política, a menos que um período de retenção mais longo seja exigido ou permitido por lei.
            </p>

            <h2>9. Transferência Internacional de Dados</h2>
            <p>
              Alguns provedores utilizados pela plataforma (por exemplo, de hospedagem, armazenamento de arquivos e inteligência artificial) podem tratar dados em servidores localizados fora do Brasil. Nesses casos, a transferência deve observar as hipóteses e salvaguardas previstas na LGPD.
            </p>

            <h2>10. Cookies</h2>
            <p>
              Utilizamos cookies essenciais para autenticação e funcionamento do serviço. Quando habilitada no ambiente, a medição de uso (Google Analytics) também pode utilizar cookies. Você pode gerenciar preferências de cookies através das configurações do navegador.
            </p>

            <h2>11. Menores de Idade</h2>
            <p>
              Nosso serviço não é direcionado a menores de 18 anos. Não coletamos intencionalmente informações pessoais de menores.
            </p>

            <h2>12. Alterações nesta Política</h2>
            <p>
              Podemos atualizar esta Política periodicamente. Notificaremos você sobre mudanças significativas por e-mail ou através de aviso proeminente no serviço.
            </p>

            <h2>13. Encarregado de Dados (DPO)</h2>
            <p>
              Para exercer seus direitos ou esclarecer dúvidas sobre esta Política, entre em contato com nosso Encarregado de Proteção de Dados através do sistema de suporte.
            </p>

            <h2>14. Autoridade Nacional de Proteção de Dados (ANPD)</h2>
            <p>
              Você tem o direito de apresentar uma reclamação à Autoridade Nacional de Proteção de Dados (ANPD) se acreditar que o tratamento de seus dados pessoais viola a LGPD.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
