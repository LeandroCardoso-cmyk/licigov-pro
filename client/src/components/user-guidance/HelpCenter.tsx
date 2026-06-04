import React, { useState } from "react";

interface HelpArticle {
  id:       string;
  title:    string;
  content:  string;
  category: string;
  tags:     string[];
}

interface Props {
  articles?: HelpArticle[];
}

const DEFAULT_ARTICLES: HelpArticle[] = [
  {
    id: "art_1",
    title: "Como criar um Termo de Referência",
    content: "Para criar um TR, acesse o menu Processos > Novo Processo e siga o wizard de elaboração.",
    category: "Processos",
    tags: ["tr", "processo", "elaboracao"],
  },
  {
    id: "art_2",
    title: "Revisão de itens CATMAT",
    content: "Acesse a aba de Revisão de Itens para aprovar, rejeitar ou substituir candidatos gerados automaticamente.",
    category: "Revisão",
    tags: ["catmat", "revisao", "itens"],
  },
  {
    id: "art_3",
    title: "Aprovação no workflow institucional",
    content: "O workflow segue os estágios definidos para sua organização. Você receberá notificações quando uma ação for necessária.",
    category: "Workflow",
    tags: ["workflow", "aprovacao", "estagio"],
  },
];

export function HelpCenter({ articles = DEFAULT_ARTICLES }: Props) {
  const [query, setQuery]     = useState("");
  const [selected, setSelected] = useState<HelpArticle | null>(null);

  const filtered = articles.filter(a =>
    a.title.toLowerCase().includes(query.toLowerCase()) ||
    a.tags.some(t => t.includes(query.toLowerCase())),
  );

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem", maxWidth: 700 }}>
      <h3 style={{ marginBottom: "0.75rem" }}>Central de Ajuda</h3>
      <input
        type="text"
        placeholder="Buscar artigos..."
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{ width: "100%", padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: 4, marginBottom: "1rem", boxSizing: "border-box" }}
      />

      <div style={{ display: "flex", gap: "1rem" }}>
        <div style={{ flex: "0 0 220px" }}>
          {filtered.map(a => (
            <div
              key={a.id}
              onClick={() => setSelected(a)}
              style={{
                padding: "0.75rem", borderRadius: 6, cursor: "pointer", marginBottom: "0.5rem",
                background: selected?.id === a.id ? "#eff6ff" : "#f9fafb",
                border: selected?.id === a.id ? "1px solid #93c5fd" : "1px solid #e5e7eb",
              }}
            >
              <div style={{ fontWeight: 500, fontSize: "0.875rem" }}>{a.title}</div>
              <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>{a.category}</div>
            </div>
          ))}
          {filtered.length === 0 && <p style={{ color: "#9ca3af", fontSize: "0.875rem" }}>Nenhum artigo encontrado.</p>}
        </div>

        <div style={{ flex: 1, background: "#f9fafb", borderRadius: 8, padding: "1rem", minHeight: 200 }}>
          {selected ? (
            <>
              <h4 style={{ marginBottom: "0.5rem" }}>{selected.title}</h4>
              <p style={{ color: "#374151", fontSize: "0.875rem" }}>{selected.content}</p>
              <div style={{ marginTop: "0.75rem" }}>
                {selected.tags.map(t => (
                  <span key={t} style={{ background: "#e5e7eb", borderRadius: 4, padding: "0.2rem 0.5rem", marginRight: "0.3rem", fontSize: "0.75rem" }}>
                    {t}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p style={{ color: "#9ca3af", textAlign: "center", marginTop: "3rem" }}>Selecione um artigo para ler.</p>
          )}
        </div>
      </div>
    </div>
  );
}
