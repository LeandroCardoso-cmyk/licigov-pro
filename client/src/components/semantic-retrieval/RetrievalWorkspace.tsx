import React, { useState } from "react";

interface RetrievalResult {
  id: string;
  documentId: string;
  title: string;
  excerpt: string;
  score: number;
  strategy: string;
  chunkIndex: number;
}

interface RetrievalWorkspaceProps {
  organizationId: number;
}

const MOCK_RESULTS: RetrievalResult[] = [
  { id: "r1", documentId: "doc-001", title: "Edital Pregão 045/2024", excerpt: "O objeto da presente licitação é a contratação de serviços de tecnologia da informação, conforme especificações contidas no Termo de Referência...", score: 0.94, strategy: "hybrid", chunkIndex: 2 },
  { id: "r2", documentId: "doc-002", title: "Contrato Administrativo 12/2024", excerpt: "Cláusula 3ª — Das Obrigações do Contratante: Efetuar os pagamentos nas condições e preços pactuados, desde que cumpridas as formalidades...", score: 0.87, strategy: "semantic", chunkIndex: 5 },
  { id: "r3", documentId: "doc-003", title: "Parecer Jurídico 078/2024", excerpt: "Considerando a análise dos dispositivos legais aplicáveis, em especial a Lei 14.133/2021, verifica-se que o procedimento adotado...", score: 0.81, strategy: "lexical", chunkIndex: 1 },
  { id: "r4", documentId: "doc-004", title: "Ata de Registro de Preços 007/2024", excerpt: "O Município de São Paulo, por intermédio da Secretaria de Administração, registra os preços para eventual contratação dos itens constantes...", score: 0.76, strategy: "hybrid", chunkIndex: 3 },
  { id: "r5", documentId: "doc-005", title: "Termo de Referência TI/2024", excerpt: "Quantitativo estimado de 500 licenças de software de gestão empresarial, com suporte técnico 24/7 e SLA de 99,5% de disponibilidade...", score: 0.71, strategy: "semantic", chunkIndex: 7 },
];

const STRATEGY_COLORS: Record<string, string> = {
  hybrid:   "#8b5cf6",
  semantic: "#3b82f6",
  lexical:  "#10b981",
};

export default function RetrievalWorkspace({ organizationId }: RetrievalWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RetrievalResult[]>([]);
  const [loading, setLoading] = useState(false);

  function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    setTimeout(() => {
      const filtered = MOCK_RESULTS.filter(r =>
        r.title.toLowerCase().includes(query.toLowerCase()) ||
        r.excerpt.toLowerCase().includes(query.toLowerCase())
      );
      setResults(filtered.length > 0 ? filtered : MOCK_RESULTS.slice(0, 3));
      setLoading(false);
    }, 600);
  }

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <div>
          <h2 style={{ fontSize: "1.125rem", fontWeight: 700, marginBottom: "0.25rem" }}>
            Workspace de Recuperação Semântica
          </h2>
          <div style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Organização #{organizationId}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSearch()}
          placeholder="Buscar em documentos da organização..."
          style={{
            flex: 1, padding: "0.625rem 0.875rem", border: "1px solid #d1d5db",
            borderRadius: "0.5rem", fontSize: "0.875rem", outline: "none",
          }}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          style={{
            padding: "0.625rem 1.25rem", background: "#3b82f6", color: "white",
            border: "none", borderRadius: "0.5rem", fontSize: "0.875rem",
            cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Buscando..." : "Buscar"}
        </button>
      </div>

      {results.length === 0 && !loading && (
        <div style={{ textAlign: "center", color: "#9ca3af", padding: "3rem", background: "#f9fafb", borderRadius: "0.5rem" }}>
          Digite uma consulta e pressione Buscar para recuperar documentos relevantes.
        </div>
      )}

      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ fontSize: "0.8125rem", color: "#6b7280", marginBottom: "0.25rem" }}>
            {results.length} resultado{results.length !== 1 ? "s" : ""} encontrado{results.length !== 1 ? "s" : ""}
          </div>
          {results.map((r, idx) => (
            <div
              key={r.id}
              style={{
                border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem",
                borderLeft: `4px solid ${STRATEGY_COLORS[r.strategy] ?? "#9ca3af"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.375rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontWeight: 600, fontSize: "0.8125rem", color: "#374151" }}>#{idx + 1}</span>
                  <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{r.title}</span>
                  <span style={{
                    fontSize: "0.6875rem", padding: "0.125rem 0.375rem", borderRadius: "9999px",
                    background: STRATEGY_COLORS[r.strategy] ?? "#9ca3af", color: "white",
                  }}>
                    {r.strategy}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
                  <div style={{ width: "48px", height: "6px", background: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${r.score * 100}%`, background: r.score > 0.8 ? "#10b981" : r.score > 0.6 ? "#f59e0b" : "#ef4444" }} />
                  </div>
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#374151" }}>{Math.round(r.score * 100)}%</span>
                </div>
              </div>
              <div style={{ fontSize: "0.8125rem", color: "#6b7280", lineHeight: 1.5 }}>
                {r.excerpt.slice(0, 180)}{r.excerpt.length > 180 ? "..." : ""}
              </div>
              <div style={{ marginTop: "0.375rem", fontSize: "0.6875rem", color: "#9ca3af" }}>
                {r.documentId} • chunk #{r.chunkIndex}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
