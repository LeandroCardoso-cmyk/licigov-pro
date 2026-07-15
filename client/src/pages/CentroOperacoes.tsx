import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BackToDashboard } from "@/components/BackToDashboard";
import DepartmentOperationHome from "@/components/department-operation/DepartmentOperationHome";

/**
 * RC-1 — Página do Centro de Operações do Departamento de Licitações.
 * Wrapper de integração: header padrão + Home do domínio consolidador (já existente).
 */
export default function CentroOperacoes() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-4">
            <BackToDashboard variant="ghost" />
            <div>
              <Breadcrumbs items={[{ label: "Centro de Operações" }]} className="mb-2" />
              <h1 className="text-3xl font-bold">Centro de Operações</h1>
              <p className="text-muted-foreground mt-1">Visão consolidada do departamento — painel, calendário, timeline e caixa.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="container py-6">
        <DepartmentOperationHome />
      </div>
    </div>
  );
}
