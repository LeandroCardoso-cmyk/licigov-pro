import React from "react";
import { HelpCircle } from "lucide-react";
import { PageShell } from "@/components/ui/PageHeader";
import TirarDuvidasHome from "@/components/tirar-duvidas/TirarDuvidasHome";

/**
 * RC-5.1 — Página do Business Domain "Tirar Dúvidas" (Institutional Consultation).
 * Ferramenta oficial de consulta técnica normativa (não um chat genérico).
 */
export default function TirarDuvidas() {
  return (
    <PageShell
      icon={HelpCircle}
      breadcrumbs={[{ label: "Tirar Dúvidas" }]}
      title="Tirar Dúvidas"
      description="Faça perguntas sobre licitações públicas e receba orientações fundamentadas na legislação, nos Tribunais de Contas e nas normas do seu município."
      showBack
    >
      <TirarDuvidasHome />
    </PageShell>
  );
}
