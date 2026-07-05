import React, { useState, useEffect } from "react";

interface OntologyConcept {
  name: string;
  definition: string;
  legalBasis: string;
}

interface OntologyCategory {
  id: string;
  name: string;
  definition: string;
  legalBasis: string;
  concepts: OntologyConcept[];
}

const mockCategories: OntologyCategory[] = [
  {
    id: "modalidade",
    name: "Modalidade",
    definition: "Forma pela qual se conduz o procedimento licitatório",
    legalBasis: "Art. 28, Lei 14.133/2021",
    concepts: [
      { name: "Pregao", definition: "Modalidade para aquisicao de bens e servicos comuns", legalBasis: "Art. 28, I" },
      { name: "Concorrencia", definition: "Modalidade para obras, servicos especiais e compras de grande vulto", legalBasis: "Art. 28, II" },
      { name: "Dialogo Competitivo", definition: "Modalidade para contratacoes com inovacao tecnologica", legalBasis: "Art. 28, V" },
    ],
  },
  {
    id: "criterio_julgamento",
    name: "Criterio de Julgamento",
    definition: "Parametro objetivo para selecao da proposta mais vantajosa",
    legalBasis: "Art. 33, Lei 14.133/2021",
    concepts: [
      { name: "Menor Preco", definition: "Selecao pela proposta de menor valor", legalBasis: "Art. 33, I" },
      { name: "Melhor Tecnica", definition: "Selecao pela proposta tecnicamente superior", legalBasis: "Art. 33, II" },
      { name: "Tecnica e Preco", definition: "Ponderacao entre qualidade tecnica e valor", legalBasis: "Art. 33, III" },
    ],
  },
  {
    id: "fase_processual",
    name: "Fase Processual",
    definition: "Etapas do procedimento licitatorio",
    legalBasis: "Art. 17, Lei 14.133/2021",
    concepts: [
      { name: "Planejamento", definition: "Fase preparatoria com estudos e documentos", legalBasis: "Art. 18" },
      { name: "Selecao", definition: "Fase externa com publicacao e julgamento", legalBasis: "Art. 17, I" },
      { name: "Contratual", definition: "Fase de formalizacao e execucao do contrato", legalBasis: "Art. 89" },
      { name: "Gestao", definition: "Acompanhamento e fiscalizacao contratual", legalBasis: "Art. 117" },
    ],
  },
];

export default function OntologyExplorer() {
  const [categories, setCategories] = useState<OntologyCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => {
      setCategories(mockCategories);
      setLoading(false);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <div className="h-6 w-48 bg-gray-200 rounded animate-pulse" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 ml-4">
            <div className="h-5 w-64 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-40 bg-gray-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Ontologia de Licitacoes</h2>
      <div className="space-y-2">
        {categories.map((category) => (
          <div key={category.id}>
            <button
              onClick={() => toggleCategory(category.id)}
              className="flex items-center gap-2 w-full text-left p-2 rounded hover:bg-gray-50"
            >
              <span className="text-gray-500 text-sm">
                {expandedCategories.has(category.id) ? "▼" : "▶"}
              </span>
              <span className="font-semibold text-gray-800">{category.name}</span>
              <span className="text-xs text-gray-500 ml-2">
                ({category.concepts.length} conceitos)
              </span>
            </button>
            {expandedCategories.has(category.id) && (
              <div className="ml-4 border-l-2 border-gray-200 pl-3">
                <p className="text-sm text-gray-600 mb-1">{category.definition}</p>
                <p className="text-xs text-gray-500 italic mb-2">{category.legalBasis}</p>
                <div className="ml-4 space-y-2">
                  {category.concepts.map((concept) => (
                    <div key={concept.name} className="ml-4 p-2 bg-gray-50 rounded">
                      <p className="text-sm font-medium text-gray-700">{concept.name}</p>
                      <p className="text-xs text-gray-500">{concept.definition}</p>
                      <p className="text-xs text-gray-400 italic">{concept.legalBasis}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
