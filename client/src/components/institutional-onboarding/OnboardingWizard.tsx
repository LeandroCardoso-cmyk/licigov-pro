import React, { useState } from "react";

type Step = "municipio" | "departamentos" | "usuarios" | "templates" | "revisao";

const STEPS: Step[] = ["municipio", "departamentos", "usuarios", "templates", "revisao"];

const STEP_LABELS: Record<Step, string> = {
  municipio:    "Dados do Município",
  departamentos: "Departamentos",
  usuarios:     "Usuários",
  templates:    "Templates Operacionais",
  revisao:      "Revisão Final",
};

interface Props {
  organizationId: number;
  onComplete?:    (data: Record<string, unknown>) => void;
}

export function OnboardingWizard({ organizationId, onComplete }: Props) {
  const [currentStep, setCurrentStep] = useState<Step>("municipio");
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const currentIdx = STEPS.indexOf(currentStep);
  const isFirst    = currentIdx === 0;
  const isLast     = currentIdx === STEPS.length - 1;

  function advance() {
    if (!isLast) setCurrentStep(STEPS[currentIdx + 1]);
    else onComplete?.({ ...formData, organizationId });
  }

  function back() {
    if (!isFirst) setCurrentStep(STEPS[currentIdx - 1]);
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 640 }}>
      <h2 style={{ marginBottom: "0.5rem" }}>Onboarding Institucional</h2>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {STEPS.map((step, i) => (
          <div
            key={step}
            style={{
              flex: 1, height: 6, borderRadius: 3,
              background: i <= currentIdx ? "#2563eb" : "#e5e7eb",
            }}
          />
        ))}
      </div>

      <div style={{ marginBottom: "0.5rem", color: "#6b7280", fontSize: "0.875rem" }}>
        Passo {currentIdx + 1} de {STEPS.length}
      </div>
      <h3 style={{ marginBottom: "1.5rem" }}>{STEP_LABELS[currentStep]}</h3>

      <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "1.5rem", minHeight: 120, marginBottom: "1.5rem" }}>
        {currentStep === "municipio" && (
          <div>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>Nome do Município</label>
            <input
              type="text"
              placeholder="Ex: São Paulo"
              style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 4, boxSizing: "border-box" }}
              onChange={e => setFormData(d => ({ ...d, municipio: e.target.value }))}
            />
          </div>
        )}
        {currentStep === "departamentos" && (
          <p style={{ color: "#6b7280" }}>Configure os departamentos responsáveis pelos processos de contratação.</p>
        )}
        {currentStep === "usuarios" && (
          <p style={{ color: "#6b7280" }}>Adicione os usuários responsáveis pela elaboração e aprovação dos TRs.</p>
        )}
        {currentStep === "templates" && (
          <p style={{ color: "#6b7280" }}>Selecione os templates operacionais adequados às necessidades do município.</p>
        )}
        {currentStep === "revisao" && (
          <div>
            <p style={{ fontWeight: 500 }}>Resumo do onboarding:</p>
            <pre style={{ fontSize: "0.8rem", color: "#374151" }}>{JSON.stringify(formData, null, 2)}</pre>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
        {!isFirst && (
          <button
            onClick={back}
            style={{ padding: "0.5rem 1rem", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer" }}
          >
            Voltar
          </button>
        )}
        <button
          onClick={advance}
          style={{ padding: "0.5rem 1.25rem", background: "#2563eb", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 500 }}
        >
          {isLast ? "Concluir Onboarding" : "Próximo"}
        </button>
      </div>
    </div>
  );
}
