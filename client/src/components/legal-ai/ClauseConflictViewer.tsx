import React from "react";

interface ClauseInput {
  id: string;
  content: string;
  title?: string;
}

interface Props {
  clauses?: ClauseInput[];
  organizationId?: number;
}

type ConflictType = "direto" | "indireto";

interface Conflict {
  clauseAId: string;
  clauseATitle: string;
  clauseBId: string;
  clauseBTitle: string;
  type: ConflictType;
  compatibilityScore: number;
  resolution: string;
}

const DEFAULT_CLAUSES: ClauseInput[] = [
  { id: "cl1", title: "Cláusula 5ª — Prazo de Vigência", content: "O contrato terá vigência de 12 meses contados da assinatura." },
  { id: "cl2", title: "Cláusula 12ª — Prorrogação Automática", content: "O contrato se prorroga automaticamente por igual período." },
  { id: "cl3", title: "Cláusula 8ª — Penalidades", content: "Multa de 10% sobre o valor global em caso de rescisão unilateral." },
  { id: "cl4", title: "Cláusula 15ª — Rescisão", content: "A rescisão unilateral implica pagamento de 5% como indenização." },
];

const MOCK_CONFLICTS: Conflict[] = [
  {
    clauseAId: "cl1",
    clauseATitle: "Cláusula 5ª — Prazo de Vigência",
    clauseBId: "cl2",
    clauseBTitle: "Cláusula 12ª — Prorrogação Automática",
    type: "direto",
    compatibilityScore: 0.22,
    resolution: "Retirar prorrogação automática ou condicionar à manifestação expressa das partes conforme art. 107 da Lei 14133/2021.",
  },
  {
    clauseAId: "cl3",
    clauseATitle: "Cláusula 8ª — Penalidades",
    clauseBId: "cl4",
    clauseBTitle: "Cláusula 15ª — Rescisão",
    type: "direto",
    compatibilityScore: 0.35,
    resolution: "Unificar percentuais de multa e indenização para evitar duplicidade de cobrança sobre o mesmo fato gerador.",
  },
];

function compatibilityColor(score: number): string {
  if (score >= 0.7) return "#10b981";
  if (score >= 0.4) return "#f59e0b";
  return "#ef4444";
}

function compatibilityBg(score: number): string {
  if (score >= 0.7) return "#ecfdf5";
  if (score >= 0.4) return "#fffbeb";
  return "#fef2f2";
}

export default function ClauseConflictViewer({ clauses = [], organizationId = 1 }: Props) {
  const activeClauses = clauses.length > 0 ? clauses : DEFAULT_CLAUSES;
  const directConflicts = MOCK_CONFLICTS.filter(c => c.type === "direto");
  const indirectConflicts = MOCK_CONFLICTS.filter(c => c.type === "indireto");

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Conflitos entre Cláusulas</h2>
        <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Org: {organizationId}</span>
      </div>

      {/* Counters */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem" }}>
        <div style={{ padding: "0.5rem 0.75rem", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "0.5rem", textAlign: "center", minWidth: "100px" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#ef4444" }}>{directConflicts.length}</div>
          <div style={{ fontSize: "0.7rem", color: "#7f1d1d" }}>Conflitos Críticos (Diretos)</div>
        </div>
        <div style={{ padding: "0.5rem 0.75rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "0.5rem", textAlign: "center", minWidth: "100px" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#f59e0b" }}>{indirectConflicts.length}</div>
          <div style={{ fontSize: "0.7rem", color: "#92400e" }}>Conflitos Indiretos</div>
        </div>
        <div style={{ padding: "0.5rem 0.75rem", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", textAlign: "center", minWidth: "100px" }}>
          <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#374151" }}>{activeClauses.length}</div>
          <div style={{ fontSize: "0.7rem", color: "#6b7280" }}>Cláusulas Analisadas</div>
        </div>
      </div>

      {/* Compatibility matrix */}
      <div style={{ marginBottom: "1.25rem" }}>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>Matriz de Compatibilidade</h3>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: "0.75rem", width: "100%" }}>
            <thead>
              <tr>
                <th style={{ padding: "0.375rem 0.5rem", background: "#f9fafb", border: "1px solid #e5e7eb", textAlign: "left", fontWeight: 600, color: "#6b7280" }}>Cláusula</th>
                {activeClauses.map(c => (
                  <th key={c.id} style={{ padding: "0.375rem 0.5rem", background: "#f9fafb", border: "1px solid #e5e7eb", textAlign: "center", fontWeight: 600, color: "#6b7280", minWidth: "60px" }}>
                    {c.title ? c.title.split("—")[0].trim() : c.id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeClauses.map(rowClause => (
                <tr key={rowClause.id}>
                  <td style={{ padding: "0.375rem 0.5rem", border: "1px solid #e5e7eb", background: "#f9fafb", fontWeight: 500, color: "#374151", whiteSpace: "nowrap" }}>
                    {rowClause.title ? rowClause.title.split("—")[0].trim() : rowClause.id}
                  </td>
                  {activeClauses.map(colClause => {
                    if (rowClause.id === colClause.id) {
                      return (
                        <td key={colClause.id} style={{ padding: "0.375rem 0.5rem", border: "1px solid #e5e7eb", background: "#f3f4f6", textAlign: "center", color: "#9ca3af" }}>
                          —
                        </td>
                      );
                    }
                    const conflict = MOCK_CONFLICTS.find(
                      c => (c.clauseAId === rowClause.id && c.clauseBId === colClause.id) ||
                           (c.clauseAId === colClause.id && c.clauseBId === rowClause.id)
                    );
                    const score = conflict ? conflict.compatibilityScore : 0.95;
                    return (
                      <td key={colClause.id} style={{ padding: "0.375rem 0.5rem", border: "1px solid #e5e7eb", background: compatibilityBg(score), textAlign: "center", color: compatibilityColor(score), fontWeight: 600 }}>
                        {Math.round(score * 100)}%
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ display: "flex", gap: "1rem", marginTop: "0.375rem" }}>
          <span style={{ fontSize: "0.7rem", color: "#10b981" }}>● Compatível (&ge;70%)</span>
          <span style={{ fontSize: "0.7rem", color: "#f59e0b" }}>● Atenção (40–70%)</span>
          <span style={{ fontSize: "0.7rem", color: "#ef4444" }}>● Conflito (&lt;40%)</span>
        </div>
      </div>

      {/* Conflict list */}
      {MOCK_CONFLICTS.length > 0 && (
        <div>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, color: "#374151", marginBottom: "0.5rem" }}>Detalhes dos Conflitos</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {MOCK_CONFLICTS.map((c, i) => (
              <div key={i} style={{ border: "1px solid #fca5a5", borderRadius: "0.5rem", padding: "0.625rem 0.75rem", background: "#fef2f2" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.375rem" }}>
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#7f1d1d", background: "white", padding: "0.1rem 0.375rem", borderRadius: "3px", border: "1px solid #fca5a5" }}>
                      {c.clauseATitle.split("—")[0].trim()}
                    </span>
                    <span style={{ fontSize: "0.7rem", color: "#ef4444", alignSelf: "center" }}>vs</span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#7f1d1d", background: "white", padding: "0.1rem 0.375rem", borderRadius: "3px", border: "1px solid #fca5a5" }}>
                      {c.clauseBTitle.split("—")[0].trim()}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "0.375rem", alignItems: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.375rem", borderRadius: "9999px", background: c.type === "direto" ? "#fef2f2" : "#fffbeb", color: c.type === "direto" ? "#ef4444" : "#f59e0b", border: `1px solid ${c.type === "direto" ? "#fca5a5" : "#fde68a"}`, fontWeight: 600 }}>
                      {c.type}
                    </span>
                    <span style={{ fontSize: "0.75rem", fontWeight: 700, color: compatibilityColor(c.compatibilityScore) }}>
                      {Math.round(c.compatibilityScore * 100)}%
                    </span>
                  </div>
                </div>
                <div style={{ background: "white", borderRadius: "0.375rem", padding: "0.375rem 0.5rem", border: "1px solid #e5e7eb" }}>
                  <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#374151" }}>Resolução: </span>
                  <span style={{ fontSize: "0.7rem", color: "#6b7280" }}>{c.resolution}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
