import { ChevronDown } from "lucide-react";

const faqs = [
  {
    question: "Como funciona a precificação do LiciGov Pro?",
    answer:
      "O LiciGov Pro oferece planos flexíveis baseados no porte do órgão e volume de processos. Entre em contato através do botão 'Solicitar Proposta' para receber uma proposta comercial personalizada sem compromisso.",
  },
  {
    question: "Quanto tempo leva a implementação?",
    answer:
      "A implementação é rápida e simples. Após a contratação, o sistema fica disponível em até 48 horas. Oferecemos treinamento completo para sua equipe e suporte técnico contínuo.",
  },
  {
    question: "O sistema está em conformidade com a Lei 14.133/21?",
    answer:
      "Sim! O LiciGov Pro foi desenvolvido seguindo rigorosamente as diretrizes da Lei 14.133/2021 (Nova Lei de Licitações). Todos os documentos gerados (ETP, TR, DFD, Edital) seguem as exigências legais e incluem as justificativas técnicas necessárias.",
  },
  {
    question: "Preciso de conhecimento técnico avançado para usar?",
    answer:
      "Não! O LiciGov Pro foi projetado para ser intuitivo e fácil de usar. Se você sabe preencher um formulário online, consegue usar o sistema. Além disso, oferecemos treinamento completo e suporte técnico sempre que precisar.",
  },
  {
    question: "Os documentos gerados podem ser editados?",
    answer:
      "Sim! Todos os documentos gerados pela IA podem ser editados diretamente no sistema. Você tem controle total sobre o conteúdo, podendo ajustar, adicionar ou remover informações conforme necessário.",
  },
  {
    question: "Como funciona a integração com CATMAT/CATSER?",
    answer:
      "O sistema se integra diretamente com os catálogos oficiais CATMAT (materiais) e CATSER (serviços) do Governo Federal. Ao criar um processo, você pode buscar e selecionar itens padronizados, garantindo conformidade e agilizando a elaboração do Termo de Referência.",
  },
  {
    question: "Qual o suporte oferecido?",
    answer:
      "Oferecemos suporte técnico completo via e-mail, chat e telefone durante horário comercial. Para casos urgentes, temos canais prioritários de atendimento. Além disso, disponibilizamos documentação completa e tutoriais em vídeo.",
  },
  {
    question: "Meus dados estão seguros?",
    answer:
      "Absolutamente! Utilizamos criptografia de ponta a ponta, backups automáticos diários e infraestrutura em nuvem de alta disponibilidade. Todos os dados são armazenados em servidores seguros no Brasil, em conformidade com a LGPD.",
  },
];

export function FAQSection() {
  return (
    <section className="py-20 bg-white">
      <div className="container mx-auto px-4">
        <div className="max-w-3xl mx-auto">
          <h3 className="text-3xl md:text-4xl font-bold text-center mb-4 text-gray-900">
            Perguntas Frequentes
          </h3>
          <p className="text-center text-gray-600 mb-12">Tire suas dúvidas sobre o LiciGov Pro</p>
          <div className="space-y-4">
            {faqs.map((faq, index) => (
              <details
                key={index}
                className="group bg-gray-50 rounded-lg p-6 hover:bg-gray-100 transition-colors"
              >
                <summary className="flex justify-between items-center cursor-pointer list-none">
                  <h4 className="text-lg font-semibold text-gray-900 pr-8">{faq.question}</h4>
                  <ChevronDown className="h-5 w-5 text-gray-500 group-open:rotate-180 transition-transform flex-shrink-0" />
                </summary>
                <p className="mt-4 text-gray-600 leading-relaxed">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
