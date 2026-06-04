import React from "react";

interface TrainingModule {
  id:          string;
  title:       string;
  description: string;
  completed:   boolean;
  durationMin: number;
  order:       number;
}

interface Props {
  modules:  TrainingModule[];
  onStart?: (moduleId: string) => void;
}

export function TrainingProgress({ modules, onStart }: Props) {
  const sorted    = [...modules].sort((a, b) => a.order - b.order);
  const completed = sorted.filter(m => m.completed).length;
  const progress  = sorted.length > 0 ? Math.round((completed / sorted.length) * 100) : 0;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem", maxWidth: 600 }}>
      <h3 style={{ marginBottom: "0.5rem" }}>Centro de Treinamento</h3>

      <div style={{ marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem", marginBottom: 4 }}>
          <span>Progresso geral</span>
          <span>{completed}/{sorted.length} módulos ({progress}%)</span>
        </div>
        <div style={{ background: "#e5e7eb", borderRadius: 4, height: 10 }}>
          <div style={{ background: "#16a34a", height: 10, borderRadius: 4, width: `${progress}%`, transition: "width 0.3s" }} />
        </div>
      </div>

      {sorted.map(module => (
        <div
          key={module.id}
          style={{
            display: "flex", alignItems: "center", gap: "0.75rem",
            background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8,
            padding: "0.75rem", marginBottom: "0.5rem",
            opacity: module.completed ? 0.7 : 1,
          }}
        >
          <div
            style={{
              width: 28, height: 28, borderRadius: "50%",
              background: module.completed ? "#16a34a" : "#e5e7eb",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: module.completed ? "#fff" : "#9ca3af", fontWeight: 700, fontSize: "0.875rem",
              flexShrink: 0,
            }}
          >
            {module.completed ? "✓" : module.order}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{module.title}</div>
            <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
              {module.description} · {module.durationMin} min
            </div>
          </div>
          {!module.completed && (
            <button
              onClick={() => onStart?.(module.id)}
              style={{ padding: "0.35rem 0.75rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: "0.8rem" }}
            >
              Iniciar
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
