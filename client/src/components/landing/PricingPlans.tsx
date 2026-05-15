import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { Link } from "wouter";

const plans = [
  {
    name: "Básico",
    subtitle: "Essencial para começar",
    highlighted: false,
    features: [
      "Gestão de Processos Licitatórios",
      "Geração de Documentos (ETP, TR, DFD)",
      "Dashboard e Relatórios Básicos",
      "Até 3 usuários",
      "Suporte por email",
    ],
  },
  {
    name: "Profissional",
    subtitle: "Completo para a maioria dos órgãos",
    highlighted: true,
    features: [
      { text: "Tudo do Básico +", bold: true },
      "Contratação Direta",
      "Gestão de Contratos",
      "Parecer Jurídico com IA",
      "Colaboração em Equipe",
      "Até 10 usuários",
      "Suporte prioritário",
    ],
  },
  {
    name: "Enterprise",
    subtitle: "Solução completa e customizada",
    highlighted: false,
    features: [
      { text: "Tudo do Profissional +", bold: true },
      "Gestão do Departamento",
      "Busca Inteligente Avançada",
      "Segurança e Auditoria Completa",
      "Usuários ilimitados",
      "Suporte dedicado + treinamento",
      "Customizações sob demanda",
    ],
  },
];

type FeatureItem = string | { text: string; bold: boolean };

function PlanCard({ plan }: { plan: (typeof plans)[number] }) {
  return (
    <Card
      className={`border-2 transition-all h-full flex flex-col ${
        plan.highlighted
          ? "border-slate-500 hover:border-slate-600 hover:shadow-2xl relative"
          : "hover:border-blue-300 hover:shadow-xl"
      }`}
    >
      {plan.highlighted && (
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
          <span className="bg-gradient-to-r from-slate-600 to-slate-700 text-white px-4 py-1 rounded-full text-sm font-semibold shadow-lg">
            ⭐ Mais Popular
          </span>
        </div>
      )}
      <CardContent className="p-8 flex flex-col h-full">
        <div className="mb-6">
          <h4 className="text-2xl font-bold text-gray-900 mb-2">{plan.name}</h4>
          <p className="text-gray-600 text-sm">{plan.subtitle}</p>
        </div>
        <div className="mb-6">
          <div className="text-4xl font-bold text-slate-600 mb-2">Sob Consulta</div>
          <p className="text-sm text-gray-500">Preço personalizado</p>
        </div>
        <ul className="space-y-3 mb-8 flex-grow">
          {plan.features.map((item: FeatureItem, i) => {
            const label = typeof item === "string" ? item : item.text;
            const bold = typeof item === "string" ? false : item.bold;
            return (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                <span className={`text-gray-700 text-sm${bold ? " font-semibold" : ""}`}>{label}</span>
              </li>
            );
          })}
        </ul>
        <Button
          asChild
          className={`w-full ${
            plan.highlighted
              ? "bg-gradient-to-r from-slate-600 to-slate-700 hover:from-slate-700 hover:to-slate-800"
              : "bg-gray-100 text-gray-900 hover:bg-gray-200"
          }`}
        >
          <Link href="/solicitar-proposta">Solicitar Proposta</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function PricingPlans() {
  return (
    <section className="bg-gradient-to-br from-gray-50 to-white py-20">
      <div className="container mx-auto px-4">
        <div className="text-center mb-12">
          <h3 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Planos e Preços</h3>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto">
            Escolha o plano ideal baseado nas <strong>funcionalidades</strong> que seu órgão precisa
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {plans.map((plan) => (
            <PlanCard key={plan.name} plan={plan} />
          ))}
        </div>

        <p className="text-center text-gray-600 mt-12 max-w-3xl mx-auto">
          <strong>Importante:</strong> Todos os planos são baseados em <strong>funcionalidades</strong>, não no
          tamanho do município. Qualquer órgão pode escolher o plano que melhor atende suas necessidades
          operacionais.
        </p>
      </div>
    </section>
  );
}
