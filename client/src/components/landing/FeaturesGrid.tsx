import { Card, CardContent } from "@/components/ui/card";
import { AnimatedSection } from "@/components/AnimatedSection";
import { FileText, Clock, Users, BarChart3, Shield, Zap, FileCheck, ScrollText, Scale, Calendar } from "lucide-react";

const features = [
  {
    icon: FileText,
    title: "Gestão Completa de Processos",
    description: "Organize todos os seus processos licitatórios em um só lugar. Acompanhe status, prazos e documentos de forma centralizada.",
    image: "/feature-process-management.png",
  },
  {
    icon: Clock,
    title: "Geração Automática de Documentos",
    description: "Crie ETP, TR, DFD e Editais automaticamente com IA. Economize horas de trabalho manual e reduza erros.",
    image: "/feature-ai-documents.png",
  },
  {
    icon: Users,
    title: "Colaboração em Equipe",
    description: "Trabalhe em equipe com controle de versões, comentários e histórico completo de alterações.",
    image: "/feature-collaboration.png",
  },
  {
    icon: BarChart3,
    title: "Dashboard e Relatórios",
    description: "Visualize métricas, estatísticas e gráficos em tempo real. Exporte relatórios personalizados em Excel.",
    image: "/feature-dashboard-analytics.png",
  },
  {
    icon: Shield,
    title: "Segurança e Auditoria",
    description: "Registro completo de todas as atividades. Controle de acesso e backup automático dos documentos.",
    image: "/feature-security-audit.png",
  },
  {
    icon: Zap,
    title: "Busca Inteligente",
    description: "Encontre qualquer processo, documento ou informação instantaneamente com busca avançada.",
    image: "/feature-process-management.png",
  },
  {
    icon: FileCheck,
    title: "Contratação Direta",
    description: "Gestão simplificada de dispensas e inexigibilidades. Controle completo de contratações diretas com conformidade legal.",
    image: "/feature-direct-contracting.png",
  },
  {
    icon: ScrollText,
    title: "Gestão de Contratos",
    description: "Acompanhamento completo do ciclo de vida dos contratos. Alertas de renovação, vencimento e gestão de fornecedores.",
    image: "/feature-contract-management.png",
  },
  {
    icon: Scale,
    title: "Parecer Jurídico com IA",
    description: "Análise automatizada de conformidade legal. IA identifica riscos e valida documentos conforme Lei 14.133/2021.",
    image: "/feature-legal-opinion.png",
  },
  {
    icon: Calendar,
    title: "Gestão do Departamento",
    description: "Calendário de tarefas, prazos e notificações automáticas. Organize a equipe e nunca perca um prazo importante.",
    image: "/feature-department-management.png",
  },
];

export function FeaturesGrid() {
  return (
    <section className="container mx-auto px-4 py-20">
      <div className="text-center mb-12">
        <h3 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Funcionalidades Completas</h3>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto">
          Tudo que você precisa para gerenciar processos licitatórios de forma profissional
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <AnimatedSection key={index} animation="slide-up" delay={index * 100}>
              <Card className="border-2 hover:border-slate-400 hover:shadow-2xl transition-all duration-300 hover:-translate-y-3 hover:scale-105 cursor-pointer overflow-hidden group h-full flex flex-col">
                <div className="relative h-48 overflow-hidden bg-gradient-to-br from-slate-50 to-blue-50">
                  <img
                    src={feature.image}
                    alt={feature.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />
                  <div className="absolute bottom-4 left-4 w-12 h-12 bg-white rounded-lg flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <Icon className="h-6 w-6 text-slate-600 group-hover:rotate-12 transition-transform duration-300" />
                  </div>
                </div>
                <CardContent className="p-6">
                  <h4 className="text-xl font-bold text-gray-900 mb-3">{feature.title}</h4>
                  <p className="text-gray-600 leading-relaxed">{feature.description}</p>
                </CardContent>
              </Card>
            </AnimatedSection>
          );
        })}
      </div>
    </section>
  );
}
