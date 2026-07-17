import React from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BackToDashboard } from "@/components/BackToDashboard";
import TirarDuvidasHome from "@/components/tirar-duvidas/TirarDuvidasHome";

/**
 * RC-5.1 — Página do Business Domain "Tirar Dúvidas" (Institutional Consultation).
 * Ferramenta oficial de consulta técnica normativa (não um chat genérico).
 */
export default function TirarDuvidas() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-4">
            <BackToDashboard variant="ghost" />
            <div>
              <Breadcrumbs items={[{ label: "Tirar Dúvidas" }]} className="mb-2" />
              <h1 className="text-3xl font-bold">Tirar Dúvidas</h1>
              <p className="text-muted-foreground mt-1">
                Faça perguntas sobre licitações públicas e receba orientações fundamentadas na
                legislação, nos Tribunais de Contas e nas normas do seu município.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="container py-6">
        <TirarDuvidasHome />
      </div>
    </div>
  );
}
