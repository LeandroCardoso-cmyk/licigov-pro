import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BackToDashboard } from "@/components/BackToDashboard";
import DirectProcurementHome from "@/components/direct-procurement/DirectProcurementHome";

/**
 * RC-1 — Página do Business Domain Contratação Direta.
 * Wrapper de integração: header padrão + Home do domínio (já existente).
 */
export default function DirectProcurement() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-4">
            <BackToDashboard variant="ghost" />
            <div>
              <Breadcrumbs items={[{ label: "Contratação Direta" }]} className="mb-2" />
              <h1 className="text-3xl font-bold">Contratação Direta</h1>
              <p className="text-muted-foreground mt-1">Dispensa e Inexigibilidade — do início ao contrato.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="container py-6">
        <DirectProcurementHome />
      </div>
    </div>
  );
}
