import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BackToDashboard } from "@/components/BackToDashboard";
import LegalOpinionHome from "@/components/legal-opinion/LegalOpinionHome";

/**
 * RC-1 — Página do Business Domain Parecer Jurídico.
 * Wrapper de integração: header padrão + Home do domínio (já existente).
 */
export default function ParecerJuridico() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-4">
            <BackToDashboard variant="ghost" />
            <div>
              <Breadcrumbs items={[{ label: "Parecer Jurídico" }]} className="mb-2" />
              <h1 className="text-3xl font-bold">Parecer Jurídico</h1>
              <p className="text-muted-foreground mt-1">Caixa institucional do Procurador — receber, emitir, assinar e devolver.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="container py-6">
        <LegalOpinionHome />
      </div>
    </div>
  );
}
