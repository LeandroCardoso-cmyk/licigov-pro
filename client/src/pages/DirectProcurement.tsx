import React from "react";
import { FileCheck } from "lucide-react";
import { PageShell } from "@/components/ui/PageHeader";
import DirectProcurementHome from "@/components/direct-procurement/DirectProcurementHome";

/**
 * RC-1 — Página do Business Domain Contratação Direta.
 * Wrapper de integração: PageHeader canônico + Home do domínio (já existente).
 */
export default function DirectProcurement() {
  return (
    <PageShell
      icon={FileCheck}
      breadcrumbs={[{ label: "Contratação Direta" }]}
      title="Contratação Direta"
      description="Dispensa e Inexigibilidade — do início ao contrato."
      showBack
    >
      <DirectProcurementHome />
    </PageShell>
  );
}
