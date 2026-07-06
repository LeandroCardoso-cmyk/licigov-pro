import React, { useState } from "react";
import { trpc } from "../../lib/trpc";

export default function DomainNavigation() {
  const { data, isLoading } = trpc.businessDomain.listDomains.useQuery();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <nav className="w-64 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
      <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Módulos
      </p>

      {isLoading ? (
        <div className="space-y-1">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : !data || data.visible.length === 0 ? (
        <p className="px-2 py-4 text-sm text-gray-500">
          Nenhum módulo licenciado.
        </p>
      ) : (
        <ul className="space-y-1">
          {data.visible.map((d) => {
            const isActive = selected === d.code;
            return (
              <li key={d.code}>
                <button
                  type="button"
                  onClick={() => setSelected(d.code)}
                  className={
                    "w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition " +
                    (isActive
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-gray-700 hover:bg-gray-50")
                  }
                >
                  {d.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}
