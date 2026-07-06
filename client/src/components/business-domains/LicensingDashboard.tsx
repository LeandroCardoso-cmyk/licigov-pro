import React from "react";
import { trpc } from "../../lib/trpc";

function planBadgeClasses(plan: string): string {
  switch (plan) {
    case "basic":
      return "bg-blue-100 text-blue-800";
    case "professional":
      return "bg-indigo-100 text-indigo-800";
    case "enterprise":
      return "bg-purple-100 text-purple-800";
    case "trial":
    default:
      return "bg-gray-100 text-gray-700";
  }
}

export default function LicensingDashboard() {
  const modulesQuery = trpc.moduleLicensing.listModules.useQuery();
  const featuresQuery = trpc.moduleLicensing.listFeatures.useQuery();

  const isLoading = modulesQuery.isLoading || featuresQuery.isLoading;

  const activeModules =
    modulesQuery.data?.modules.filter((m) => m.active).length ?? 0;
  const enabledFeatures =
    featuresQuery.data?.features.filter((f) => f.enabled).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Módulos ativos</p>
          {isLoading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded bg-gray-100" />
          ) : (
            <p className="mt-1 text-3xl font-bold text-green-600">
              {activeModules}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-gray-500">
            Features habilitadas
          </p>
          {isLoading ? (
            <div className="mt-2 h-8 w-16 animate-pulse rounded bg-gray-100" />
          ) : (
            <p className="mt-1 text-3xl font-bold text-indigo-600">
              {enabledFeatures}
            </p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Visão geral dos módulos
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        ) : !modulesQuery.data || modulesQuery.data.modules.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">
            Nenhum módulo licenciado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-3 py-2 font-medium">Módulo</th>
                  <th className="px-3 py-2 font-medium">Plano</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {modulesQuery.data.modules.map((m) => (
                  <tr key={m.id} className="border-b border-gray-100">
                    <td className="px-3 py-2 font-medium text-gray-800">
                      {m.businessDomainCode}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " +
                          planBadgeClasses(m.plan)
                        }
                      >
                        {m.plan}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium " +
                          (m.active
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-600")
                        }
                      >
                        {m.active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
