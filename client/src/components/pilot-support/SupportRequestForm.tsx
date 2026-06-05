import React, { useState } from "react";

type IncidentSeverity = "low" | "medium" | "high" | "critical";
type IncidentCategory = "workflow" | "deployment" | "support" | "onboarding" | "data" | "security" | "performance";

interface Props {
  organizationId: number;
  userId:         number;
  onSubmit?:      (data: { title: string; description: string; severity: IncidentSeverity; category: IncidentCategory }) => void;
}

const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  low: "Baixa", medium: "Média", high: "Alta", critical: "Crítica",
};

const CATEGORY_LABELS: Record<IncidentCategory, string> = {
  workflow:    "Workflow",
  deployment:  "Implantação",
  support:     "Suporte Geral",
  onboarding:  "Onboarding",
  data:        "Dados",
  security:    "Segurança",
  performance: "Performance",
};

export function SupportRequestForm({ organizationId, userId, onSubmit }: Props) {
  const [title,       setTitle]       = useState("");
  const [description, setDescription] = useState("");
  const [severity,    setSeverity]    = useState<IncidentSeverity>("medium");
  const [category,    setCategory]    = useState<IncidentCategory>("support");
  const [submitted,   setSubmitted]   = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !description.trim()) return;
    onSubmit?.({ title: title.trim(), description: description.trim(), severity, category });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div style={{ fontFamily: "sans-serif", padding: "1.5rem", textAlign: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>✅</div>
        <h3 style={{ color: "#16a34a" }}>Solicitação enviada</h3>
        <p style={{ color: "#6b7280", fontSize: "0.875rem" }}>Nossa equipe entrará em contato em breve.</p>
        <button
          onClick={() => { setSubmitted(false); setTitle(""); setDescription(""); }}
          style={{ marginTop: "1rem", padding: "0.5rem 1rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}
        >
          Nova Solicitação
        </button>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 560 }}>
      <h3 style={{ marginBottom: "1rem" }}>Abrir Chamado de Suporte</h3>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.875rem" }}>Título *</label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Descreva o problema em uma linha"
            required
            style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 4, boxSizing: "border-box" }}
          />
        </div>

        <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.875rem" }}>Severidade</label>
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as IncidentSeverity)}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 4 }}
            >
              {(["low", "medium", "high", "critical"] as IncidentSeverity[]).map(s => (
                <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.875rem" }}>Categoria</label>
            <select
              value={category}
              onChange={e => setCategory(e.target.value as IncidentCategory)}
              style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 4 }}
            >
              {(Object.keys(CATEGORY_LABELS) as IncidentCategory[]).map(c => (
                <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: "1rem" }}>
          <label style={{ display: "block", fontWeight: 500, marginBottom: "0.25rem", fontSize: "0.875rem" }}>Descrição *</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={4}
            placeholder="Descreva o problema com detalhes..."
            required
            style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 4, boxSizing: "border-box", resize: "vertical" }}
          />
        </div>

        <button
          type="submit"
          style={{ padding: "0.5rem 1.25rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}
        >
          Enviar Chamado
        </button>
      </form>
    </div>
  );
}
