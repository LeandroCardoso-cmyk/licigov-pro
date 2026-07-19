import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import DepartmentOperationHome from "@/components/department-operation/DepartmentOperationHome";

/**
 * RC-1 — Página do Centro de Operações do Departamento de Licitações.
 * Wrapper de integração: header institucional único + Home do domínio consolidador.
 *
 * O cabeçalho da página é provido AQUI; por isso `DepartmentOperationHome` recebe
 * `showPageHeader={false}` (evita título "Centro de Operações" duplicado). Como esta
 * é a home canônica dentro do shell (DashboardLayout), não há botão "Voltar".
 */
export default function CentroOperacoes() {
  return (
    <div className="bg-background">
      <div className="border-b bg-card">
        <div className="container py-6">
          <Breadcrumbs items={[{ label: "Centro de Operações" }]} className="mb-2" />
          <h1 className="text-3xl font-bold text-foreground">Centro de Operações</h1>
          <p className="text-muted-foreground mt-1">Visão consolidada do departamento — painel, calendário, timeline e caixa.</p>
        </div>
      </div>
      <div className="container py-6">
        <DepartmentOperationHome showPageHeader={false} />
      </div>
    </div>
  );
}
