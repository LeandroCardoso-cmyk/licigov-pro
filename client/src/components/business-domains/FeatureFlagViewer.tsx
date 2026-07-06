import React from "react";
import { trpc } from "../../lib/trpc";

export default function FeatureFlagViewer() {
  const { data, isLoading } = trpc.moduleLicensing.listFeatures.useQuery();

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Feature flags</h2>
        {data ? (
          <span className="text-sm text-gray-500">{data.total} flag(s)</span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded bg-gray-100" />
          ))}
        </div>
      ) : !data || data.features.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-500">
          Nenhuma feature flag configurada.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.features.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-gray-800">
                  {f.featureKey}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {f.businessDomainCode} · {f.rolloutStrategy}
                </p>
              </div>
              <span
                className={
                  "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition " +
                  (f.enabled ? "bg-green-500" : "bg-gray-300")
                }
                aria-label={f.enabled ? "Habilitado" : "Desabilitado"}
                role="img"
              >
                <span
                  className={
                    "inline-block h-4 w-4 transform rounded-full bg-white shadow transition " +
                    (f.enabled ? "translate-x-6" : "translate-x-1")
                  }
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
