import React, { useState } from "react";

type EnvironmentType = "development" | "staging" | "production";

interface Environment {
  id:     string;
  name:   string;
  type:   EnvironmentType;
  status: string;
  version: string;
}

interface Props {
  environments: Environment[];
  onCreate?:    (name: string, type: EnvironmentType) => void;
}

const TYPE_LABELS: Record<EnvironmentType, string> = {
  development: "Desenvolvimento",
  staging:     "Homologação",
  production:  "Produção",
};

const TYPE_COLORS: Record<EnvironmentType, string> = {
  development: "#2563eb",
  staging:     "#d97706",
  production:  "#16a34a",
};

export function EnvironmentSetup({ environments, onCreate }: Props) {
  const [showForm, setShowForm]   = useState(false);
  const [name, setName]           = useState("");
  const [envType, setEnvType]     = useState<EnvironmentType>("development");

  function handleCreate() {
    if (!name.trim()) return;
    onCreate?.(name.trim(), envType);
    setName("");
    setShowForm(false);
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0 }}>Ambientes</h3>
        <button
          onClick={() => setShowForm(v => !v)}
          style={{ padding: "0.4rem 0.8rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: "0.875rem" }}
        >
          + Novo Ambiente
        </button>
      </div>

      {showForm && (
        <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", marginBottom: "1rem" }}>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>Nome</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ex: staging-sp"
              style={{ width: "100%", padding: "0.4rem", border: "1px solid #d1d5db", borderRadius: 4, boxSizing: "border-box" }}
            />
          </div>
          <div style={{ marginBottom: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 500 }}>Tipo</label>
            <select
              value={envType}
              onChange={e => setEnvType(e.target.value as EnvironmentType)}
              style={{ width: "100%", padding: "0.4rem", border: "1px solid #d1d5db", borderRadius: 4 }}
            >
              <option value="development">Desenvolvimento</option>
              <option value="staging">Homologação</option>
              <option value="production">Produção</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            style={{ padding: "0.4rem 1rem", background: "#16a34a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
          >
            Criar
          </button>
        </div>
      )}

      {environments.length === 0 && <p style={{ color: "#9ca3af" }}>Nenhum ambiente configurado.</p>}

      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
        {environments.map(env => (
          <div key={env.id} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "1rem", minWidth: 160 }}>
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{env.name}</div>
            <span style={{ background: TYPE_COLORS[env.type], color: "#fff", borderRadius: 4, padding: "0.15rem 0.4rem", fontSize: "0.75rem" }}>
              {TYPE_LABELS[env.type]}
            </span>
            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.5rem" }}>v{env.version} · {env.status}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
