import React, { useState, useEffect } from "react";

type RiskLevel = "baixo" | "medio" | "alto" | "critico";
type ClauseCategory = "Objeto" | "Habilitacao" | "Pagamento" | "Penalidades" | "Garantias";

interface Clause {
  id: string;
  title: string;
  purpose: string;
  riskLevel: RiskLevel;
  legalBasis: string;
  category: ClauseCategory;
  relatedDocumentsCount: number;
}

const mockClauses: Clause[] = [
  { id: "cl1", title: "Descricao do Objeto", purpose: "Define com precisao o que sera contratado, evitando ambiguidades.", riskLevel: "alto", legalBasis: "Art. 6, XXIII", category: "Objeto", relatedDocumentsCount: 5 },
  { id: "cl2", title: "Especificacoes Tecnicas", purpose: "Detalha requisitos tecnicos minimos para aceitacao do objeto.", riskLevel: "medio", legalBasis: "Art. 40, I", category: "Objeto", relatedDocumentsCount: 3 },
  { id: "cl3", title: "Qualificacao Tecnica", purpose: "Estabelece requisitos de capacidade tecnica do licitante.", riskLevel: "alto", legalBasis: "Art. 67", category: "Habilitacao", relatedDocumentsCount: 4 },
  { id: "cl4", title: "Qualificacao Economico-Financeira", purpose: "Define indices e exigencias patrimoniais para participacao.", riskLevel: "medio", legalBasis: "Art. 69", category: "Habilitacao", relatedDocumentsCount: 2 },
  { id: "cl5", title: "Condicoes de Pagamento", purpose: "Estabelece prazos, forma e documentos necessarios para liquidacao.", riskLevel: "baixo", legalBasis: "Art. 92, V", category: "Pagamento", relatedDocumentsCount: 3 },
  { id: "cl6", title: "Multa por Inadimplemento", purpose: "Define percentuais e hipoteses de aplicacao de multa contratual.", riskLevel: "critico", legalBasis: "Art. 156, II", category: "Penalidades", relatedDocumentsCount: 6 },
  { id: "cl7", title: "Sancoes Administrativas", purpose: "Tipifica infrações e graduacoes de penalidades aplicaveis.", riskLevel: "critico", legalBasis: "Art. 155", category: "Penalidades", relatedDocumentsCount: 4 },
  { id: "cl8", title: "Garantia de Execucao", purpose: "Estabelece modalidade e percentual de garantia contratual exigida.", riskLevel: "alto", legalBasis: "Art. 96", category: "Garantias", relatedDocumentsCount: 3 },
];

const categories: ClauseCategory[] = ["Objeto", "Habilitacao", "Pagamento", "Penalidades", "Garantias"];

const riskStyles: Record<RiskLevel, string> = {
  baixo: "bg-green-100 text-green-800",
  medio: "bg-yellow-100 text-yellow-800",
  alto: "bg-orange-100 text-orange-800",
  critico: "bg-red-100 text-red-800",
};

export default function ClauseKnowledgePanel() {
  const [clauses, setClauses] = useState<Clause[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<ClauseCategory | "all">("all");

  useEffect(() => {
    const timer = setTimeout(() => {
      setClauses(mockClauses);
      setLoading(false);
    }, 550);
    return () => clearTimeout(timer);
  }, []);

  const filtered = selectedCategory === "all"
    ? clauses
    : clauses.filter((c) => c.category === selectedCategory);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="h-10 w-56 bg-gray-100 rounded animate-pulse" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-24 w-full bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Base de Clausulas</h2>
      <div className="mb-4">
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value as ClauseCategory | "all")}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">Todas as categorias</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>
      <div className="space-y-3">
        {filtered.map((clause) => (
          <div key={clause.id} className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-gray-800">{clause.title}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskStyles[clause.riskLevel]}`}>
                {clause.riskLevel}
              </span>
            </div>
            <p className="text-sm text-gray-600">{clause.purpose}</p>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs italic text-gray-500">{clause.legalBasis}</span>
              <span className="text-xs text-gray-400">
                {clause.relatedDocumentsCount} documentos relacionados
              </span>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-4">
            Nenhuma clausula encontrada nesta categoria.
          </p>
        )}
      </div>
    </div>
  );
}
