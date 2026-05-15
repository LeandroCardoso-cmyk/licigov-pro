import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { APP_TITLE, APP_LOGO } from "@/const";
import { Link } from "wouter";
import { AnimatedSection } from "@/components/AnimatedSection";
import WhatsAppButton from "@/components/WhatsAppButton";
import { FeaturesGrid } from "@/components/landing/FeaturesGrid";
import { FAQSection } from "@/components/landing/FAQSection";
import { ContactForm } from "@/components/landing/ContactForm";
import { PricingPlans } from "@/components/landing/PricingPlans";

const benefits = [
  "Redução significativa do tempo de elaboração de processos",
  "100% de conformidade com a Lei 14.133/2021",
  "Eliminação de erros manuais em documentos",
  "Centralização de informações e documentos",
  "Rastreabilidade completa de alterações",
  "Segurança e backup automático",
];

const howItWorks = [
  {
    step: "1",
    title: "Cadastre o Processo",
    description: "Informe o objeto da contratação, valor estimado e modalidade em um formulário simples e intuitivo.",
  },
  {
    step: "2",
    title: "IA Gera os Documentos",
    description: "Nossa inteligência artificial cria automaticamente ETP, TR, DFD e Edital conforme a Lei 14.133/21.",
  },
  {
    step: "3",
    title: "Revise e Personalize",
    description: "Edite os documentos gerados, adicione informações específicas e colabore com sua equipe.",
  },
  {
    step: "4",
    title: "Exporte e Publique",
    description: "Baixe os documentos em PDF ou DOCX e publique seu processo licitatório com total conformidade legal.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <WhatsAppButton />

      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50 shadow-sm">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src={APP_LOGO} alt="LiciGov Pro" className="h-20 w-auto" />
            <h1 className="text-2xl font-bold text-gray-900">{APP_TITLE}</h1>
          </div>
          <div className="flex gap-3">
            <Button asChild className="bg-slate-600 hover:bg-slate-700">
              <a href="/login">Entrar no Sistema</a>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative py-16 md:py-24 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img
            src="/hero-background-government.jpg"
            alt="Prédios Governamentais"
            className="w-full h-full object-cover"
            style={{ filter: "blur(4px)" }}
          />
          <div className="absolute inset-0 bg-gradient-to-br from-slate-700/80 via-slate-600/70 to-blue-900/75"></div>
        </div>
        <div className="container mx-auto px-4 relative z-10">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <div className="inline-block px-4 py-2 bg-white/90 text-slate-700 rounded-full text-sm font-semibold backdrop-blur-sm">
                🚀 Plataforma Oficial para Licitações Públicas
              </div>
              <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white leading-tight drop-shadow-lg">
                Simplifique a Gestão de
                <span className="text-yellow-300"> Processos Licitatórios</span>
              </h2>
              <p className="text-xl text-white/95 leading-relaxed drop-shadow-md">
                Plataforma completa para órgãos públicos gerenciarem licitações com <strong>eficiência</strong>,{" "}
                <strong>conformidade</strong> e <strong>agilidade</strong>. Geração automática de documentos com
                Inteligência Artificial.
              </p>
              <div className="flex gap-4 flex-wrap">
                    <Button
                  asChild
                  size="lg"
                  className="bg-white text-slate-700 hover:bg-slate-50 text-lg px-8 shadow-2xl hover:shadow-3xl transition-all animate-breathing font-bold"
                >
                  <Link href="/solicitar-proposta" className="flex items-center">
                    Solicitar Proposta Comercial
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="relative">
              <div className="relative z-10 rounded-2xl overflow-hidden shadow-2xl animate-float">
                <img src="/hero-dashboard-mockup.png" alt="Dashboard LiciGov Pro" className="w-full h-auto" />
              </div>
              <div className="absolute -top-4 -right-4 w-72 h-72 bg-slate-300 rounded-full mix-blend-multiply filter blur-xl opacity-50 animate-blob"></div>
              <div className="absolute -bottom-8 -left-4 w-72 h-72 bg-blue-300 rounded-full mix-blend-multiply filter blur-xl opacity-50 animate-blob animation-delay-2000"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Benefícios Principais */}
      <section className="bg-gradient-to-r from-slate-600 to-slate-700 text-white py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h3 className="text-3xl md:text-4xl font-bold mb-4">Por que escolher o LiciGov Pro?</h3>
            <p className="text-xl text-slate-200 max-w-2xl mx-auto">Benefícios comprovados para órgãos públicos</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {benefits.map((benefit, index) => (
              <div
                key={index}
                className="flex items-start gap-3 bg-slate-700/30 p-4 rounded-lg backdrop-blur-sm hover:bg-slate-700/40 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-400 to-blue-400 flex items-center justify-center flex-shrink-0 shadow-lg">
                  <CheckCircle2 className="h-5 w-5 text-white" />
                </div>
                <span className="text-slate-50">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FeaturesGrid />

      {/* Como Funciona */}
      <section className="bg-gradient-to-br from-slate-50 to-blue-50 py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h3 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Como Funciona</h3>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Em 4 passos simples, você cria processos licitatórios completos e conformes
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {howItWorks.map((item, index) => (
              <AnimatedSection key={index} animation="slide-up" delay={index * 150}>
                <div className="relative h-full flex flex-col">
                  <div className="bg-white rounded-xl p-6 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 h-full group">
                    <div className="w-12 h-12 bg-gradient-to-br from-slate-600 to-slate-700 text-white rounded-full flex items-center justify-center text-2xl font-bold mb-4 shadow-lg group-hover:scale-110 group-hover:rotate-12 transition-all duration-300">
                      {item.step}
                    </div>
                    <h4 className="text-lg font-bold text-gray-900 mb-2">{item.title}</h4>
                    <p className="text-gray-600 text-sm">{item.description}</p>
                  </div>
                  {index < howItWorks.length - 1 && (
                    <div className="hidden lg:block absolute top-1/2 -right-4 transform -translate-y-1/2 z-10">
                      <ArrowRight className="h-8 w-8 text-slate-400 animate-pulse" />
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
                Geração Automática de Documentos com{" "}
                <span className="text-slate-600">Inteligência Artificial</span>
              </h3>
              <p className="text-lg text-gray-600">
                Nossa IA especializada em licitações públicas cria automaticamente todos os documentos necessários,
                seguindo rigorosamente a <strong>Lei 14.133/2021</strong>.
              </p>
              <ul className="space-y-3">
                {[
                  "ETP (Estudo Técnico Preliminar) completo",
                  "TR (Termo de Referência) detalhado",
                  "DFD (Documento de Formalização da Demanda)",
                  "Edital com todos os anexos necessários",
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
                Trabalhe em Equipe com <span className="text-slate-600">Total Transparência</span>
              </h3>
              <p className="text-lg text-gray-600">
                Colabore com sua equipe em tempo real. Controle de versões, comentários e histórico completo de todas
                as alterações.
              </p>
              <ul className="space-y-3">
                {[
                  "Convide membros e defina permissões",
                  "Histórico completo de alterações",
                  "Comentários e revisões em documentos",
                  "Notificações automáticas de atualizações",
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

      <FAQSection />
      <ContactForm />
      <PricingPlans />

      {/* CTA Final */}
      <section className="bg-gradient-to-r from-slate-600 to-slate-700 text-white py-20">
        <div className="container mx-auto px-4 text-center">
          <h3 className="text-3xl md:text-4xl font-bold mb-4">
            Pronto para modernizar seus processos licitatórios?
          </h3>
          <p className="text-xl text-blue-100 mb-8 max-w-2xl mx-auto">
            Solicite uma proposta comercial personalizada para o seu órgão. Sem compromisso.
          </p>
          {/* @ts-ignore - asChild is valid but TypeScript doesn't recognize it */}
          <Button
            asChild
            size="lg"
            className="text-lg px-8 bg-white text-slate-700 hover:bg-gray-100 shadow-lg hover:shadow-xl transition-all"
          >
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
          <p className="text-sm">© 2024 {APP_TITLE}. Todos os direitos reservados.</p>
          <p className="text-xs text-gray-500 mt-2">
            Desenvolvido em conformidade com a Lei 14.133/2021 - Nova Lei de Licitações
          </p>
        </div>
      </footer>

      <style>{`
        @keyframes blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob { animation: blob 7s infinite; }
        .animation-delay-2000 { animation-delay: 2s; }
      `}</style>
    </div>
  );
}
