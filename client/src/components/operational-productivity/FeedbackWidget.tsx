import React, { useState } from "react";

type FeedbackCategory = "workflow" | "ux" | "productivity" | "friction" | "feature_satisfaction";

interface Props {
  organizationId: number;
  userId:         number;
  context:        string; // current screen/feature
  onSubmit?:      (category: FeedbackCategory, rating: number, message: string) => void;
}

const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  workflow:             "Workflow",
  ux:                   "Experiência",
  productivity:         "Produtividade",
  friction:             "Fricção/Dificuldade",
  feature_satisfaction: "Funcionalidade",
};

export function FeedbackWidget({ organizationId, userId, context, onSubmit }: Props) {
  const [open,     setOpen]     = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("ux");
  const [rating,   setRating]   = useState<number | null>(null);
  const [message,  setMessage]  = useState("");
  const [done,     setDone]     = useState(false);

  function submit() {
    if (rating === null) return;
    onSubmit?.(category, rating, message);
    setDone(true);
    setTimeout(() => { setOpen(false); setDone(false); setRating(null); setMessage(""); }, 2000);
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Dar feedback"
        style={{
          width: 36, height: 36, borderRadius: "50%", background: "#f3f4f6",
          border: "1px solid #d1d5db", cursor: "pointer", fontSize: "1rem",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        💬
      </button>

      {open && (
        <div
          style={{
            position: "absolute", bottom: "calc(100% + 8px)", right: 0,
            background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12,
            padding: "1rem", width: 280, boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            zIndex: 100,
          }}
        >
          {done ? (
            <div style={{ textAlign: "center", color: "#16a34a", fontFamily: "sans-serif" }}>
              ✅ Obrigado pelo feedback!
            </div>
          ) : (
            <div style={{ fontFamily: "sans-serif" }}>
              <div style={{ fontWeight: 600, marginBottom: "0.75rem", fontSize: "0.875rem" }}>
                Feedback — {context}
              </div>

              <select
                value={category}
                onChange={e => setCategory(e.target.value as FeedbackCategory)}
                style={{ width: "100%", padding: "0.35rem", border: "1px solid #d1d5db", borderRadius: 4, marginBottom: "0.75rem", fontSize: "0.8rem" }}
              >
                {(Object.keys(CATEGORY_LABELS) as FeedbackCategory[]).map(c => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>

              <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem", justifyContent: "center" }}>
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setRating(n)}
                    style={{
                      width: 36, height: 36, borderRadius: 4, border: "1px solid",
                      borderColor: rating === n ? "#2563eb" : "#d1d5db",
                      background: rating === n ? "#eff6ff" : "#fff",
                      cursor: "pointer", fontSize: "1rem",
                    }}
                  >
                    {["😡", "😕", "😐", "🙂", "😄"][n - 1]}
                  </button>
                ))}
              </div>

              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                rows={2}
                placeholder="Comentário opcional..."
                style={{ width: "100%", padding: "0.35rem", border: "1px solid #d1d5db", borderRadius: 4, resize: "none", boxSizing: "border-box", fontSize: "0.8rem" }}
              />

              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                <button
                  onClick={() => setOpen(false)}
                  style={{ flex: 1, padding: "0.35rem", background: "#f3f4f6", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer", fontSize: "0.8rem" }}
                >
                  Cancelar
                </button>
                <button
                  onClick={submit}
                  disabled={rating === null}
                  style={{
                    flex: 1, padding: "0.35rem", background: rating ? "#2563eb" : "#9ca3af",
                    color: "#fff", border: "none", borderRadius: 4, cursor: rating ? "pointer" : "not-allowed", fontSize: "0.8rem",
                  }}
                >
                  Enviar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
