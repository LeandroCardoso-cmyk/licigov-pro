import React from "react";
import { FileCheck } from "lucide-react";
import { PageShell } from "@/components/ui/PageHeader";
import DirectProcurementHome from "@/components/direct-procurement/DirectProcurementHome";

/**
 * RC-1 — Página do Business Domain Contratação Direta.
 * Wrapper de integração: PageHeader canônico + Home do domínio (já existente).
 */
export default function DirectProcurement() {
  // Micro-Polish: a faixa canônica NÃO exibe o "Voltar" genérico aqui, de propósito — o
  // retorno ao dashboard permanece no breadcrumb (ícone Home) e o retorno intra-módulo é o
  // contextual "← Voltar aos processos" do detalhe. Evita duas afordâncias genéricas de
  // "Voltar" competindo no mesmo contexto.
  return (
    <PageShell
      icon={FileCheck}
      breadcrumbs={[{ label: "Contratação Direta" }]}
      title="Contratação Direta"
      description="Dispensa e Inexigibilidade — do início ao contrato."
    >
      <DirectProcurementHome />
    </PageShell>
  );
}
