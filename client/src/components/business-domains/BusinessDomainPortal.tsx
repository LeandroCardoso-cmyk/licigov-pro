import React from "react";
import { trpc } from "../../lib/trpc";
import BusinessDomainCard from "./BusinessDomainCard";

export default function BusinessDomainPortal() {
  const { data, isLoading } = trpc.businessDomain.listDomains.useQuery();

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          LICIGOV PRO — Escolha um módulo
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Selecione um dos módulos licenciados para abrir seu workspace.
        </p>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-40 animate-pulse rounded-xl border border-gray-100 bg-gray-100"
            />
          ))}
        </div>
      ) : !data || data.visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-12 text-center">
          <p className="text-base font-medium text-gray-700">
            Nenhum módulo licenciado
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Sua organização ainda não possui módulos comerciais ativos. Entre em
            contato com a administração para habilitar um módulo.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.visible.map((d) => (
            <BusinessDomainCard
              key={d.code}
              domain={{
                code: d.code,
                name: d.name,
                workspaceType: d.workspaceType,
                licensed: d.licensed,
                active: d.active,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
