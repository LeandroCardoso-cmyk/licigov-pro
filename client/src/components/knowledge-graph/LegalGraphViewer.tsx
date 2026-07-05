import React, { useState, useEffect } from "react";

type VigenciaStatus = "vigente" | "revogada" | "alterada";

interface Jurisprudencia {
  id: string;
  tribunal: string;
  ementa: string;
  vigencia: VigenciaStatus;
}

interface Inciso {
  id: string;
  numero: string;
  texto: string;
  vigencia: VigenciaStatus;
}

interface Artigo {
  id: string;
  numero: string;
  ementa: string;
  vigencia: VigenciaStatus;
  incisos: Inciso[];
  jurisprudencias: Jurisprudencia[];
}

interface Lei {
  id: string;
  nome: string;
  vigencia: VigenciaStatus;
  artigos: Artigo[];
}

const mockLei: Lei = {
  id: "lei-14133",
  nome: "Lei 14.133/2021",
  vigencia: "vigente",
  artigos: [
    {
      id: "art-6", numero: "Art. 6", ementa: "Definicoes", vigencia: "vigente",
      incisos: [
        { id: "art6-i", numero: "I", texto: "Obra: toda atividade estabelecida", vigencia: "vigente" },
        { id: "art6-ii", numero: "II", texto: "Servico: toda atividade destinada", vigencia: "vigente" },
        { id: "art6-xxiii", numero: "XXIII", texto: "Termo de Referencia", vigencia: "alterada" },
      ],
      jurisprudencias: [
        { id: "j1", tribunal: "TCU Acordao 1234/2023", ementa: "Definicao de servico comum", vigencia: "vigente" },
        { id: "j2", tribunal: "TCU Acordao 5678/2022", ementa: "Limites do TR", vigencia: "vigente" },
      ],
    },
    {
      id: "art-18", numero: "Art. 18", ementa: "Estudo Tecnico Preliminar", vigencia: "vigente",
      incisos: [
        { id: "art18-i", numero: "I", texto: "Descricao da necessidade", vigencia: "vigente" },
        { id: "art18-ii", numero: "II", texto: "Demonstracao da previsao", vigencia: "vigente" },
      ],
      jurisprudencias: [
        { id: "j3", tribunal: "TCU Acordao 9012/2023", ementa: "Obrigatoriedade do ETP", vigencia: "vigente" },
      ],
    },
    {
      id: "art-28", numero: "Art. 28", ementa: "Modalidades de Licitacao", vigencia: "vigente",
      incisos: [
        { id: "art28-i", numero: "I", texto: "Pregao", vigencia: "vigente" },
        { id: "art28-ii", numero: "II", texto: "Concorrencia", vigencia: "vigente" },
        { id: "art28-v", numero: "V", texto: "Dialogo Competitivo", vigencia: "alterada" },
      ],
      jurisprudencias: [],
    },
    {
      id: "art-75", numero: "Art. 75", ementa: "Dispensa de Licitacao", vigencia: "vigente",
      incisos: [
        { id: "art75-i", numero: "I", texto: "Obras ate R$ 100.000", vigencia: "alterada" },
        { id: "art75-ii", numero: "II", texto: "Servicos ate R$ 50.000", vigencia: "revogada" },
      ],
      jurisprudencias: [
        { id: "j4", tribunal: "TCU Acordao 3456/2024", ementa: "Atualizacao de valores", vigencia: "vigente" },
        { id: "j5", tribunal: "STJ REsp 2222/2023", ementa: "Fracionamento de despesa", vigencia: "vigente" },
      ],
    },
  ],
};

function VigenciaBadge({ status }: { status: VigenciaStatus }) {
  const styles: Record<VigenciaStatus, string> = {
    vigente: "bg-green-100 text-green-800",
    revogada: "bg-red-100 text-red-800",
    alterada: "bg-yellow-100 text-yellow-800",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}

export default function LegalGraphViewer() {
  const [lei, setLei] = useState<Lei | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    const timer = setTimeout(() => {
      setLei(mockLei);
      setLoading(false);
    }, 700);
    return () => clearTimeout(timer);
  }, []);

  const toggleNode = (id: string) => {
    setExpandedNodes((prev) => {
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
        <div className="h-6 w-52 bg-gray-200 rounded animate-pulse" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="ml-4 space-y-2">
            <div className="h-5 w-56 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-36 bg-gray-100 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (!lei) return null;

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-lg font-bold text-gray-900">{lei.nome}</h2>
        <VigenciaBadge status={lei.vigencia} />
      </div>
      <div className="space-y-1">
        {lei.artigos.map((artigo) => (
          <div key={artigo.id}>
            <button
              onClick={() => toggleNode(artigo.id)}
              className="flex items-center gap-2 w-full text-left p-2 rounded hover:bg-gray-50"
            >
              <span className="text-gray-400 text-xs">
                {expandedNodes.has(artigo.id) ? "▼" : "▶"}
              </span>
              <span className="font-medium text-gray-800">{artigo.numero}</span>
              <span className="text-sm text-gray-600">- {artigo.ementa}</span>
              <VigenciaBadge status={artigo.vigencia} />
            </button>
            {expandedNodes.has(artigo.id) && (
              <div className="ml-8 border-l-2 border-gray-200 pl-3 space-y-1">
                {artigo.incisos.map((inciso) => (
                  <div key={inciso.id} className="flex items-center gap-2 py-1">
                    <span className="text-xs text-gray-400">-</span>
                    <span className="text-sm text-gray-700">
                      {inciso.numero}: {inciso.texto}
                    </span>
                    <VigenciaBadge status={inciso.vigencia} />
                  </div>
                ))}
                {artigo.jurisprudencias.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
                    <p className="text-xs font-medium text-gray-500 mb-1">Jurisprudencia</p>
                    {artigo.jurisprudencias.map((j) => (
                      <div key={j.id} className="flex items-center gap-2 py-1 ml-4">
                        <span className="text-xs text-blue-500">⚖</span>
                        <span className="text-xs text-gray-600">{j.tribunal}</span>
                        <VigenciaBadge status={j.vigencia} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
