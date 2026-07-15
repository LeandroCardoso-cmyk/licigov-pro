import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BackToDashboard } from "@/components/BackToDashboard";
import ContractsHome from "@/components/contract-workspace/ContractsHome";

/**
 * RC-1 — Página do Business Domain Contratos e Instrumentos Contratuais.
 * Wrapper de integração: header padrão + Home do domínio (já existente).
 */
export default function ContratosWorkspace() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-4">
            <BackToDashboard variant="ghost" />
            <div>
              <Breadcrumbs items={[{ label: "Contratos" }]} className="mb-2" />
              <h1 className="text-3xl font-bold">Contratos</h1>
              <p className="text-muted-foreground mt-1">Contratos, aditivos, apostilamentos e rescisões — engenharia documental.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="container py-6">
        <ContractsHome />
      </div>
    </div>
  );
}
