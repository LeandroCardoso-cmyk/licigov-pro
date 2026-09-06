import React from "react";
import { Scale } from "lucide-react";
import { PageShell } from "@/components/ui/PageHeader";
import LegalOpinionHome from "@/components/legal-opinion/LegalOpinionHome";

/**
 * RC-1 — Página do Business Domain Parecer Jurídico.
 * Wrapper de integração: PageHeader canônico + Home do domínio (já existente).
 */
export default function ParecerJuridico() {
  return (
    <PageShell
      icon={Scale}
      breadcrumbs={[{ label: "Parecer Jurídico" }]}
      title="Parecer Jurídico"
      description="Caixa institucional do Procurador — receber, emitir, assinar e devolver."
      showBack
    >
      <LegalOpinionHome />
    </PageShell>
  );
}
