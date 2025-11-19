import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileText, Clock, Users, BarChart3, Shield, Zap, CheckCircle2, ArrowRight, ChevronDown } from "lucide-react";
import { APP_TITLE, APP_LOGO, getLoginUrl } from "@/const";
import { Link } from "wouter";
import { AnimatedSection } from "@/components/AnimatedSection";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState } from "react";

export default function LandingPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitContactMutation = trpc.contact.submitContactForm.useMutation();
  const features = [
    {
      icon: FileText,
      title: "Gestão Completa de Processos",
      description: "Organize todos os seus processos licitatórios em um só lugar. Acompanhe status, prazos e documentos de forma centralizada.",
      image: "/feature-process-management.png"
    },
    {
      icon: Clock,
      title: "Geração Automática de Documentos",
      description: "Crie ETP, TR, DFD e Editais automaticamente com IA. Economize horas de trabalho manual e reduza erros.",
      image: "/feature-ai-documents.png"
    },
    {
      icon: Users,
      title: "Colaboração em Equipe",
      description: "Trabalhe em equipe com controle de versões, comentários e histórico completo de alterações.",
      image: "/feature-collaboration.png"
    },
    {
      icon: BarChart3,
      title: "Dashboard e Relatórios",
      description: "Visualize métricas, estatísticas e gráficos em tempo real. Exporte relatórios personalizados em Excel.",
      image: "/feature-dashboard-analytics.png"
    },
    {
      icon: Shield,
      title: "Segurança e Auditoria",
      description: "Registro completo de todas as atividades. Controle de acesso e backup automático dos documentos.",
      image: "/feature-security-audit.png"
    },
    {
      icon: Zap,
      title: "Busca Inteligente",
      description: "Encontre qualquer processo, documento ou informação instantaneamente com busca avançada.",
      image: "/feature-process-management.png"
    }
  ];

  const howItWorks = [
    {
      step: "1",
      title: "Cadastre o Processo",
      description: "Informe o objeto da contratação, valor estimado e modalidade em um formulário simples e intuitivo."
    },
    {
      step: "2",
      title: "IA Gera os Documentos",
      description: "Nossa inteligência artificial cria automaticamente ETP, TR, DFD e Edital conforme a Lei 14.133/21."
    },
    {
      step: "3",
      title: "Revise e Personalize",
      description: "Edite os documentos gerados, adicione informações específicas e colabore com sua equipe."
    },
    {
      step: "4",
      title: "Exporte e Publique",
      description: "Baixe os documentos em PDF ou DOCX e publique seu processo licitatório com total conformidade legal."
    }
  ];

  const benefits = [
    "Redução significativa do tempo de elaboração de processos",
    "100% de conformidade com a Lei 14.133/2021",
    "Eliminação de erros manuais em documentos",
    "Centralização de informações e documentos",
    "Rastreabilidade completa de alterações",
    "Segurança e backup automático"
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src={APP_LOGO} alt="LiciGov Pro" className="h-20 w-auto" />
            <h1 className="text-2xl font-bold text-gray-900">{APP_TITLE}</h1>
          </div>
          <div className="flex gap-3">
            {/* @ts-ignore - asChild is valid but TypeScript doesn't recognize it */}
            <Button asChild className="bg-blue-600 hover:bg-blue-700">
              <a href={getLoginUrl()}>Entrar no Sistema</a>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section - Assimétrico */}
      <section className="bg-gradient-to-br from-blue-50 via-white to-indigo-50 py-16 md:py-24">
        <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          {/* Texto à esquerda */}
          <div className="space-y-6">
            <div className="inline-block px-4 py-2 bg-blue-100 text-blue-700 rounded-full text-sm font-semibold">
              🚀 Plataforma Oficial para Licitações Públicas
            </div>
            <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight">
              Simplifique a Gestão de
              <span className="text-blue-600"> Processos Licitatórios</span>
            </h2>
            <p className="text-xl text-gray-600 leading-relaxed">
              Plataforma completa para órgãos públicos gerenciarem licitações com <strong>eficiência</strong>, <strong>conformidade</strong> e <strong>agilidade</strong>. Geração automática de documentos com Inteligência Artificial.
            </p>
            <div className="flex gap-4 flex-wrap">
              {/* @ts-ignore - asChild is valid but TypeScript doesn't recognize it */}
              <Button asChild size="lg" className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-lg px-8 shadow-lg hover:shadow-xl transition-all">
                <Link href="/solicitar-proposta" className="flex items-center">
                  Solicitar Proposta Comercial
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            </div>
          </div>

          {/* Imagem à direita */}
          <div className="relative">
            <div className="relative z-10 rounded-2xl overflow-hidden shadow-2xl">
              <img 
                src="/hero-dashboard-mockup.png" 
                alt="Dashboard LiciGov Pro" 
                className="w-full h-auto"
              />
            </div>
            {/* Elementos decorativos */}
            <div className="absolute -top-4 -right-4 w-72 h-72 bg-blue-200 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob"></div>
            <div className="absolute -bottom-8 -left-4 w-72 h-72 bg-indigo-200 rounded-full mix-blend-multiply filter blur-xl opacity-70 animate-blob animation-delay-2000"></div>
          </div>
        </div>
        </div>
      </section>

      {/* Benefícios Principais */}
      <section className="bg-gradient-to-r from-blue-600 to-blue-700 text-white py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h3 className="text-3xl md:text-4xl font-bold mb-4">
              Por que escolher o LiciGov Pro?
            </h3>
            <p className="text-xl text-blue-100 max-w-2xl mx-auto">
              Benefícios comprovados para órgãos públicos
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {benefits.map((benefit, index) => (
              <div key={index} className="flex items-start gap-3 bg-blue-700/30 p-4 rounded-lg backdrop-blur-sm">
                <CheckCircle2 className="h-6 w-6 text-green-300 flex-shrink-0 mt-0.5" />
                <span className="text-blue-50">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Funcionalidades Completas com Imagens */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-12">
          <h3 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
            Funcionalidades Completas
          </h3>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Tudo que você precisa para gerenciar processos licitatórios de forma profissional
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <AnimatedSection key={index} animation="slide-up" delay={index * 100}>
              <Card 
                key={index} 
                className="border-2 hover:border-blue-300 hover:shadow-2xl transition-all duration-300 hover:-translate-y-2 cursor-pointer overflow-hidden group"
              >
                <div className="relative h-48 overflow-hidden bg-gradient-to-br from-blue-50 to-indigo-50">
                  <img 
                    src={feature.image} 
                    alt={feature.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>
                  <div className="absolute bottom-4 right-4 left-4">
                    <p className="text-white text-sm drop-shadow-lg">{feature.description}</p>
                  </div>
                  <div className="absolute bottom-4 left-4 w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-lg">
                    <Icon className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
                <CardContent className="p-6">
                  <h4 className="text-xl font-bold text-gray-900 mb-2">{feature.title}</h4>
                  <p className="text-gray-600">{feature.description}</p>
                </CardContent>
              </Card>
              </AnimatedSection>
            );
          })}
        </div>
      </section>

      {/* Como Funciona */}
      <section className="bg-gradient-to-br from-blue-50 to-indigo-50 py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h3 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Como Funciona
            </h3>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Em 4 passos simples, você cria processos licitatórios completos e conformes
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {howItWorks.map((item, index) => (
              <AnimatedSection key={index} animation="slide-up" delay={index * 150}>
              <div className="relative">
                <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl transition-shadow h-full">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-full flex items-center justify-center text-2xl font-bold mb-4 shadow-lg">
                    {item.step}
                  </div>
                  <h4 className="text-lg font-bold text-gray-900 mb-2">{item.title}</h4>
                  <p className="text-gray-600 text-sm">{item.description}</p>
                </div>
                {index < howItWorks.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-4 transform -translate-y-1/2 z-10">
                    <ArrowRight className="h-8 w-8 text-blue-300" />
                  </div>
                )}
              </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Geração Automática com IA */}
      <section className="bg-white py-20">
        <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div className="order-2 md:order-1">
            <img 
              src="/documents-generation.png" 
              alt="Geração Automática de Documentos" 
              className="w-full h-auto rounded-2xl shadow-2xl"
            />
          </div>
          <div className="order-1 md:order-2 space-y-6">
            <h3 className="text-3xl md:text-4xl font-bold text-gray-900">
              Geração Automática de Documentos com <span className="text-blue-600">Inteligência Artificial</span>
            </h3>
            <p className="text-lg text-gray-600">
              Nossa IA especializada em licitações públicas cria automaticamente todos os documentos necessários, seguindo rigorosamente a <strong>Lei 14.133/2021</strong>.
            </p>
            <ul className="space-y-3">
              {[
                "ETP (Estudo Técnico Preliminar) completo",
                "TR (Termo de Referência) detalhado",
                "DFD (Documento de Formalização da Demanda)",
                "Edital com todos os anexos necessários"
              ].map((item, index) => (
                <li key={index} className="flex items-start gap-3">
                  <CheckCircle2 className="h-6 w-6 text-green-500 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        </div>
      </section>

      {/* Colaboração em Equipe */}
      <section className="bg-gradient-to-b from-gray-50 to-white py-20">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <h3 className="text-3xl md:text-4xl font-bold text-gray-900">
                Trabalhe em Equipe com <span className="text-blue-600">Total Transparência</span>
              </h3>
              <p className="text-lg text-gray-600">
                Colabore com sua equipe em tempo real. Controle de versões, comentários e histórico completo de todas as alterações.
              </p>
              <ul className="space-y-3">
                {[
                  "Convide membros e defina permissões",
                  "Histórico completo de alterações",
                  "Comentários e revisões em documentos",
                  "Notificações automáticas de atualizações"
                ].map((item, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <CheckCircle2 className="h-6 w-6 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <img 
                src="/collaboration-team.png" 
                alt="Colaboração em Equipe" 
                className="w-full h-auto rounded-2xl shadow-2xl"
              />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 bg-white">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto">
            <h3 className="text-3xl md:text-4xl font-bold text-center mb-4 text-gray-900">
              Perguntas Frequentes
            </h3>
            <p className="text-center text-gray-600 mb-12">
              Tire suas dúvidas sobre o LiciGov Pro
            </p>
            <div className="space-y-4">
              {[
                {
                  question: "Como funciona a precificação do LiciGov Pro?",
                  answer: "O LiciGov Pro oferece planos flexíveis baseados no porte do órgão e volume de processos. Entre em contato através do botão 'Solicitar Proposta' para receber uma proposta comercial personalizada sem compromisso."
                },
                {
                  question: "Quanto tempo leva a implementação?",
                  answer: "A implementação é rápida e simples. Após a contratação, o sistema fica disponível em até 48 horas. Oferecemos treinamento completo para sua equipe e suporte técnico contínuo."
                },
                {
                  question: "O sistema está em conformidade com a Lei 14.133/21?",
                  answer: "Sim! O LiciGov Pro foi desenvolvido seguindo rigorosamente as diretrizes da Lei 14.133/2021 (Nova Lei de Licitações). Todos os documentos gerados (ETP, TR, DFD, Edital) seguem as exigências legais e incluem as justificativas técnicas necessárias."
                },
                {
                  question: "Preciso de conhecimento técnico avançado para usar?",
                  answer: "Não! O LiciGov Pro foi projetado para ser intuitivo e fácil de usar. Se você sabe preencher um formulário online, consegue usar o sistema. Além disso, oferecemos treinamento completo e suporte técnico sempre que precisar."
                },
                {
                  question: "Os documentos gerados podem ser editados?",
                  answer: "Sim! Todos os documentos gerados pela IA podem ser editados diretamente no sistema. Você tem controle total sobre o conteúdo, podendo ajustar, adicionar ou remover informações conforme necessário."
                },
                {
                  question: "Como funciona a integração com CATMAT/CATSER?",
                  answer: "O sistema se integra diretamente com os catálogos oficiais CATMAT (materiais) e CATSER (serviços) do Governo Federal. Ao criar um processo, você pode buscar e selecionar itens padronizados, garantindo conformidade e agilizando a elaboração do Termo de Referência."
                },
                {
                  question: "Qual o suporte oferecido?",
                  answer: "Oferecemos suporte técnico completo via e-mail, chat e telefone durante horário comercial. Para casos urgentes, temos canais prioritários de atendimento. Além disso, disponibilizamos documentação completa e tutoriais em vídeo."
                },
                {
                  question: "Meus dados estão seguros?",
                  answer: "Absolutamente! Utilizamos criptografia de ponta a ponta, backups automáticos diários e infraestrutura em nuvem de alta disponibilidade. Todos os dados são armazenados em servidores seguros no Brasil, em conformidade com a LGPD."
                }
              ].map((faq, index) => (
                <details key={index} className="group bg-gray-50 rounded-lg p-6 hover:bg-gray-100 transition-colors">
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

      {/* Formulário de Contato Inline */}
      <section className="bg-white py-20">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <AnimatedSection animation="fade-in">
              <div className="text-center mb-10">
                <h3 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                  Entre em Contato
                </h3>
                <p className="text-xl text-gray-600">
                  Preencha o formulário e nossa equipe entrará em contato em até 24 horas
                </p>
              </div>

              <form 
                className="space-y-6 bg-gradient-to-br from-blue-50 to-indigo-50 p-8 rounded-2xl shadow-xl"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setIsSubmitting(true);

                  const formData = new FormData(e.currentTarget);
                  const data = {
                    name: formData.get('name') as string,
                    email: formData.get('email') as string,
                    organ: formData.get('organ') as string,
                    phone: formData.get('phone') as string,
                    message: formData.get('message') as string || undefined,
                  };

                  try {
                    await submitContactMutation.mutateAsync(data);
                    toast.success('Formulário enviado com sucesso!', {
                      description: 'Entraremos em contato em breve.',
                    });
                    e.currentTarget.reset();
                  } catch (error: any) {
                    toast.error('Erro ao enviar formulário', {
                      description: error.message || 'Tente novamente mais tarde.',
                    });
                  } finally {
                    setIsSubmitting(false);
                  }
                }}
              >
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="name" className="block text-sm font-semibold text-gray-700 mb-2">
                      Nome Completo *
                    </label>
                    <input
                      type="text"
                      id="name"
                      name="name"
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="Seu nome"
                    />
                  </div>

                  <div>
                    <label htmlFor="email" className="block text-sm font-semibold text-gray-700 mb-2">
                      E-mail *
                    </label>
                    <input
                      type="email"
                      id="email"
                      name="email"
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="seu@email.com"
                    />
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label htmlFor="organ" className="block text-sm font-semibold text-gray-700 mb-2">
                      Órgão Público *
                    </label>
                    <input
                      type="text"
                      id="organ"
                      name="organ"
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="Nome do órgão"
                    />
                  </div>

                  <div>
                    <label htmlFor="phone" className="block text-sm font-semibold text-gray-700 mb-2">
                      Telefone *
                    </label>
                    <input
                      type="tel"
                      id="phone"
                      name="phone"
                      required
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                      placeholder="(00) 00000-0000"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="message" className="block text-sm font-semibold text-gray-700 mb-2">
                    Mensagem (opcional)
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                    placeholder="Conte-nos mais sobre suas necessidades..."
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  disabled={isSubmitting}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-lg py-6 shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? 'Enviando...' : 'Enviar Solicitação'}
                  {!isSubmitting && <ArrowRight className="ml-2 h-5 w-5" />}
                </Button>

                <p className="text-sm text-gray-600 text-center">
                  Ao enviar este formulário, você concorda com nossa Política de Privacidade
                </p>
              </form>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* CTA Final */}
      <section className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-20">
        <div className="container mx-auto px-4 text-center">
          <h3 className="text-3xl md:text-4xl font-bold mb-4">
            Pronto para modernizar seus processos licitatórios?
          </h3>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Solicite uma proposta comercial personalizada para o seu órgão. Sem compromisso.
          </p>
          {/* @ts-ignore - asChild is valid but TypeScript doesn't recognize it */}
          <Button asChild size="lg" className="text-lg px-8 bg-white text-blue-600 hover:bg-gray-100 shadow-lg hover:shadow-xl transition-all">
            <Link href="/solicitar-proposta" className="flex items-center">
              Solicitar Proposta Agora
              <ArrowRight className="ml-2 h-5 w-5" />
            </Link>
          </Button>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-300 py-8">
        <div className="container mx-auto px-4 text-center">
          <p className="text-sm">
            © 2024 {APP_TITLE}. Todos os direitos reservados.
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Desenvolvido em conformidade com a Lei 14.133/2021 - Nova Lei de Licitações
          </p>
        </div>
      </footer>

      <style>{`
        @keyframes blob {
          0% {
            transform: translate(0px, 0px) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
          100% {
            transform: translate(0px, 0px) scale(1);
          }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
      `}</style>
    </div>
  );
}
