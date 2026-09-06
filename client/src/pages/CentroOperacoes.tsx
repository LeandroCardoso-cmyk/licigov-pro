import React from "react";
import { Gauge } from "lucide-react";
import { PageShell } from "@/components/ui/PageHeader";
import DepartmentOperationHome from "@/components/department-operation/DepartmentOperationHome";

/**
 * RC-1 — Página do Centro de Operações do Departamento de Licitações.
 * Wrapper de integração: PageHeader canônico único + Home do domínio consolidador.
 *
 * O cabeçalho é provido AQUI; por isso `DepartmentOperationHome` recebe
 * `showPageHeader={false}` (evita título duplicado). Como esta é a home canônica
 * dentro do shell (DashboardLayout), não há botão "Voltar".
 */
export default function CentroOperacoes() {
  return (
    <PageShell
      icon={Gauge}
      breadcrumbs={[{ label: "Centro de Operações" }]}
      title="Centro de Operações"
      description="Visão consolidada do departamento — painel, calendário, timeline e caixa. É aqui que se acompanha e age."
    >
      <DepartmentOperationHome showPageHeader={false} />
    </PageShell>
  );
}
