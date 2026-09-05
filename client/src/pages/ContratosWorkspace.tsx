import React from "react";
import { ScrollText } from "lucide-react";
import { PageShell } from "@/components/ui/PageHeader";
import ContractsHome from "@/components/contract-workspace/ContractsHome";

/**
 * RC-1 — Página do Business Domain Contratos e Instrumentos Contratuais.
 * Wrapper de integração: PageHeader canônico + Home do domínio (já existente).
 */
export default function ContratosWorkspace() {
  return (
    <PageShell
      icon={ScrollText}
      breadcrumbs={[{ label: "Contratos" }]}
      title="Contratos"
      description="Contratos, aditivos, apostilamentos e rescisões — engenharia documental."
      showBack
    >
      <ContractsHome />
    </PageShell>
  );
}
