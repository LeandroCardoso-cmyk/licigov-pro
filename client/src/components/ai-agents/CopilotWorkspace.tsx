import React, { useState } from "react";

interface Props { role?: string; documentType?: string; canProceed?: boolean; contextSummary?: string; }

export function CopilotWorkspace({ role = "general_assistant", documentType = "TR", canProceed = true, contextSummary = "" }: Props) {
  const [query, setQuery] = useState("");
  return (
    <div style={{ border: "1px solid #555", padding: 16, borderRadius: 8 }}>
      <h3>Copilot: {role}</h3>
      <p>Documento: {documentType} | {canProceed ? "✓ Pode prosseguir" : "✗ Bloqueado"}</p>
      {contextSummary && <p style={{ fontSize: 12, color: "#aaa" }}>{contextSummary}</p>}
      <textarea value={query} onChange={e => setQuery(e.target.value)} placeholder="Digite sua consulta jurídica..." rows={4} style={{ width: "100%" }} />
      <button disabled={!canProceed}>Consultar</button>
    </div>
  );
}
