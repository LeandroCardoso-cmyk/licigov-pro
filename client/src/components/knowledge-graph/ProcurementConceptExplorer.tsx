import React, { useState, useEffect } from "react";

interface ProcurementConcept {
  id: string;
  name: string;
  definition: string;
  legalBasis: string;
  aliases: string[];
  parentName: string | null;
}

type CategoryKey = "modalidades" | "criterios" | "documentos" | "fases";

const mockData: Record<CategoryKey, ProcurementConcept[]> = {
  modalidades: [
    { id: "m1", name: "Pregao Eletronico", definition: "Modalidade obrigatoria para aquisicao de bens e servicos comuns, conduzida a distancia em sessao publica por meio de sistema eletronico.", legalBasis: "Art. 28, I", aliases: ["Pregao", "PE"], parentName: null },
    { id: "m2", name: "Concorrencia", definition: "Modalidade para contratacao de bens e servicos especiais e obras e servicos comuns e especiais de engenharia.", legalBasis: "Art. 28, II", aliases: ["CC"], parentName: null },
    { id: "m3", name: "Dialogo Competitivo", definition: "Modalidade restrita a contratacoes em que a Administracao realiza dialogos com licitantes previamente selecionados.", legalBasis: "Art. 28, V", aliases: ["DC"], parentName: null },
    { id: "m4", name: "Pregao Presencial", definition: "Forma presencial do pregao, utilizada quando inviavel a forma eletronica.", legalBasis: "Art. 28, I, par. unico", aliases: ["PP"], parentName: "Pregao Eletronico" },
  ],
  criterios: [
    { id: "c1", name: "Menor Preco", definition: "Os licitantes classificados apresentam suas propostas ordenadas de forma crescente de precos.", legalBasis: "Art. 33, I", aliases: ["MP", "Menor Valor"], parentName: null },
    { id: "c2", name: "Melhor Tecnica", definition: "Selecao com base em fatores de qualificacao tecnica e capacidade operacional.", legalBasis: "Art. 33, II", aliases: ["MT"], parentName: null },
    { id: "c3", name: "Tecnica e Preco", definition: "Avaliacao das propostas de acordo com ponderacao entre qualidade tecnica e preco.", legalBasis: "Art. 33, III", aliases: ["TP", "TEP"], parentName: null },
  ],
  documentos: [
    { id: "d1", name: "DFD", definition: "Documento de Formalizacao da Demanda que identifica a necessidade de contratacao.", legalBasis: "Art. 12, par. 1", aliases: ["Documento de Formalizacao da Demanda"], parentName: null },
    { id: "d2", name: "ETP", definition: "Estudo Tecnico Preliminar que evidencia o problema a ser resolvido e a melhor solucao.", legalBasis: "Art. 18", aliases: ["Estudo Tecnico Preliminar"], parentName: "DFD" },
    { id: "d3", name: "Termo de Referencia", definition: "Documento com elementos necessarios e suficientes para caracterizar o objeto da contratacao.", legalBasis: "Art. 6, XXIII", aliases: ["TR"], parentName: "ETP" },
    { id: "d4", name: "Edital", definition: "Instrumento convocatorio que estabelece as regras da licitacao.", legalBasis: "Art. 25", aliases: ["Instrumento Convocatorio"], parentName: "Termo de Referencia" },
  ],
  fases: [
    { id: "f1", name: "Planejamento", definition: "Fase preparatoria que compreende estudos tecnicos, ETP e termo de referencia.", legalBasis: "Art. 18", aliases: ["Fase Interna", "Fase Preparatoria"], parentName: null },
    { id: "f2", name: "Selecao do Fornecedor", definition: "Conjunto de procedimentos para definicao da proposta mais vantajosa.", legalBasis: "Art. 17, I", aliases: ["Fase Externa", "Selecao"], parentName: "Planejamento" },
    { id: "f3", name: "Contratual", definition: "Formalizacao do vinculo contratual e inicio da execucao.", legalBasis: "Art. 89", aliases: ["Fase de Contratacao"], parentName: "Selecao do Fornecedor" },
  ],
};

const tabs: { key: CategoryKey; label: string }[] = [
  { key: "modalidades", label: "Modalidades" },
  { key: "criterios", label: "Criterios" },
  { key: "documentos", label: "Documentos" },
  { key: "fases", label: "Fases" },
];

export default function ProcurementConceptExplorer() {
  const [activeTab, setActiveTab] = useState<CategoryKey>("modalidades");
  const [concepts, setConcepts] = useState<Record<CategoryKey, ProcurementConcept[]> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setConcepts(mockData);
      setLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 w-24 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 w-full bg-gray-100 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (!concepts) return null;

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Conceitos de Licitacao</h2>
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              activeTab === tab.key
                ? "bg-blue-50 text-blue-700 border-b-2 border-blue-600"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {concepts[activeTab].map((concept) => (
          <div key={concept.id} className="border border-gray-200 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <h3 className="font-bold text-gray-800">{concept.name}</h3>
              {concept.parentName && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <span>←</span>
                  <span>{concept.parentName}</span>
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-1">{concept.definition}</p>
            <p className="text-sm italic text-gray-500 mt-1">{concept.legalBasis}</p>
            <div className="flex gap-1 mt-2 flex-wrap">
              {concept.aliases.map((alias) => (
                <span
                  key={alias}
                  className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full"
                >
                  {alias}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
