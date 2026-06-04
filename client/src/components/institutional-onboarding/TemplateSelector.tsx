import React, { useState } from "react";

interface Template {
  id:          string;
  category:    string;
  name:        string;
  description: string;
  legalBasis:  string[];
}

interface Props {
  templates:  Template[];
  onSelect?:  (template: Template) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  aquisicao_comum:         "Aquisição Comum",
  medicamentos:            "Medicamentos",
  combustivel:             "Combustível",
  material_expediente:     "Material de Expediente",
  servicos_terceirizados:  "Serviços Terceirizados",
  obras:                   "Obras",
  manutencao:              "Manutenção",
  ti:                      "TI",
  alimentacao_escolar:     "Alimentação Escolar",
  saude:                   "Saúde",
};

export function TemplateSelector({ templates, onSelect }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const filtered = templates.filter(t =>
    t.name.toLowerCase().includes(filter.toLowerCase()) ||
    t.category.toLowerCase().includes(filter.toLowerCase()),
  );

  function handleSelect(t: Template) {
    setSelected(t.id);
    onSelect?.(t);
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <h3 style={{ marginBottom: "0.75rem" }}>Selecionar Template Operacional</h3>
      <input
        type="text"
        placeholder="Filtrar templates..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 4, marginBottom: "1rem", boxSizing: "border-box" }}
      />

      {filtered.length === 0 && (
        <p style={{ color: "#9ca3af", textAlign: "center" }}>Nenhum template encontrado.</p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        {filtered.map(t => (
          <div
            key={t.id}
            onClick={() => handleSelect(t)}
            style={{
              border: `2px solid ${selected === t.id ? "#2563eb" : "#e5e7eb"}`,
              borderRadius: 8, padding: "1rem", cursor: "pointer",
              background: selected === t.id ? "#eff6ff" : "#fff",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{t.name}</div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.5rem" }}>
              {CATEGORY_LABELS[t.category] ?? t.category}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#374151" }}>{t.description}</div>
            <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "0.5rem" }}>
              {t.legalBasis.join(" | ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
