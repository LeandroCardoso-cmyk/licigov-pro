import React from "react";

const COPILOTS: { type: string; label: string }[] = [
  { type: "agente_contratacao", label: "Agente de Contratação" },
  { type: "pregoeiro", label: "Pregoeiro" },
  { type: "planejamento", label: "Planejamento" },
  { type: "tr_intelligence", label: "TR Intelligence" },
  { type: "juridico", label: "Jurídico" },
  { type: "pesquisa_precos", label: "Pesquisa de Preços" },
  { type: "contratos", label: "Contratos" },
  { type: "controle_interno", label: "Controle Interno" },
];

type RiskThreshold = "baixo" | "medio" | "alto" | "critico";

const RISK_OPTIONS: { value: RiskThreshold; label: string }[] = [
  { value: "baixo", label: "Baixo" },
  { value: "medio", label: "Médio" },
  { value: "alto", label: "Alto" },
  { value: "critico", label: "Crítico" },
];

function ActionList({
  title,
  items,
  color,
  onAdd,
  onRemove,
}: {
  title: string;
  items: string[];
  color: string;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
}) {
  const [draft, setDraft] = React.useState("");
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-800">{title}</h3>
      <div className="mb-2 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Nova ação"
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => {
            if (draft.trim()) {
              onAdd(draft.trim());
              setDraft("");
            }
          }}
          className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
        >
          Adicionar
        </button>
      </div>
      <ul className="flex flex-wrap gap-2">
        {items.map((item, i) => (
          <li
            key={i}
            className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${color}`}
          >
            {item}
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="ml-1 opacity-60 hover:opacity-100"
              aria-label="Remover"
            >
              ×
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-gray-400">Nenhuma ação definida.</li>}
      </ul>
    </div>
  );
}

export default function CopilotPolicyManager() {
  const [copilotType, setCopilotType] = React.useState<string>(COPILOTS[0].type);
  const [allowed, setAllowed] = React.useState<string[]>(["gerar_recomendacao", "consultar_rag"]);
  const [forbidden, setForbidden] = React.useState<string[]>(["assinar_documento"]);
  const [minConfidence, setMinConfidence] = React.useState<number>(0.6);
  const [riskThreshold, setRiskThreshold] = React.useState<RiskThreshold>("alto");

  return (
    <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-gray-900">Gestão de Políticas</h2>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Copiloto</label>
        <select
          value={copilotType}
          onChange={(e) => setCopilotType(e.target.value)}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        >
          {COPILOTS.map((c) => (
            <option key={c.type} value={c.type}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <ActionList
        title="Ações permitidas"
        items={allowed}
        color="bg-green-100 text-green-700"
        onAdd={(v) => setAllowed((prev) => [...prev, v])}
        onRemove={(i) => setAllowed((prev) => prev.filter((_, idx) => idx !== i))}
      />

      <ActionList
        title="Ações proibidas"
        items={forbidden}
        color="bg-red-100 text-red-700"
        onAdd={(v) => setForbidden((prev) => [...prev, v])}
        onRemove={(i) => setForbidden((prev) => prev.filter((_, idx) => idx !== i))}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Confiança mínima: {Math.round(minConfidence * 100)}%
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={minConfidence}
            onChange={(e) => setMinConfidence(Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Limite de risco para aprovação
          </label>
          <select
            value={riskThreshold}
            onChange={(e) => setRiskThreshold(e.target.value as RiskThreshold)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          >
            {RISK_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        disabled
        className="cursor-not-allowed rounded-md bg-indigo-300 px-4 py-2 text-sm font-medium text-white"
      >
        Salvar política
      </button>
    </div>
  );
}
