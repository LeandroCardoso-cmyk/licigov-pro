import React from "react";
import { trpc } from "../../lib/trpc";

type Plan = "trial" | "basic" | "professional" | "enterprise" | string;

function planBadgeClasses(plan: Plan): string {
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

export default function LicensedModulesPanel() {
  const { data, isLoading } = trpc.moduleLicensing.listModules.useQuery();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">
          Módulos licenciados
        </h2>
        {data ? (
          <span className="text-sm text-gray-500">{data.total} módulo(s)</span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-10 animate-pulse rounded bg-gray-100"
            />
          ))}
        </div>
      ) : !data || data.modules.length === 0 ? (
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
                <th className="px-3 py-2 font-medium">Expiração</th>
              </tr>
            </thead>
            <tbody>
              {data.modules.map((m) => (
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
                  <td className="px-3 py-2 text-gray-600">
                    {m.expirationDate ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
