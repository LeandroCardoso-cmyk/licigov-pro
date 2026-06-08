import React from "react";

interface Props {
  sessionId?: string;
  documentType?: string;
  organizationId?: number;
}

interface DocumentSection {
  id: string;
  title: string;
  content: string;
}

const MOCK_SECTIONS: DocumentSection[] = [
  {
    id: "sec1",
    title: "PREÂMBULO",
    content: "MINISTÉRIO DA GESTÃO E INOVAÇÃO EM SERVIÇOS PÚBLICOS\nSecretaria de Gestão de Pessoas e Relações do Trabalho no Serviço Público\n\nEDITAL DE PREGÃO ELETRÔNICO Nº {{NUMERO_EDITAL}}/2026\n\nObjeto: Contratação de empresa especializada para prestação de serviços contínuos de suporte técnico e manutenção de infraestrutura de TI.",
  },
  {
    id: "sec2",
    title: "1. DO OBJETO",
    content: "1.1 O presente Pregão tem por objeto a contratação de empresa especializada para prestação de serviços contínuos de suporte técnico e manutenção preventiva e corretiva de infraestrutura de tecnologia da informação.\n\n1.2 Valor estimado: R$ 480.000,00 (quatrocentos e oitenta mil reais) para 12 (doze) meses.",
  },
  {
    id: "sec3",
    title: "2. DA PARTICIPAÇÃO",
    content: "2.1 Poderão participar deste Pregão os interessados que atenderem a todas as exigências constantes deste Edital e seus Anexos.\n\n2.2 Não poderão participar deste certame: empresas em recuperação judicial, falência ou concordata; empresas reunidas em consórcio.",
  },
  {
    id: "sec4",
    title: "3. DO CREDENCIAMENTO",
    content: "3.1 O credenciamento dar-se-á pela atribuição de chave de identificação e de senha pessoal e intransferível para acesso ao sistema eletrônico.\n\n3.2 Responsável pelo credenciamento: {{RESPONSAVEL_CREDENCIAMENTO}}.",
  },
  {
    id: "sec5",
    title: "4. DA PROPOSTA",
    content: "4.1 A proposta de preços deverá ser formulada e enviada em formulário eletrônico específico.\n\n4.2 Critério de julgamento: {{CRITERIO_JULGAMENTO}}\n\n4.3 A validade da proposta será de 60 (sessenta) dias contados da data de abertura da sessão.",
  },
  {
    id: "sec6",
    title: "5. DA HABILITAÇÃO",
    content: "5.1 Para habilitação no presente certame, serão exigidos os seguintes documentos:\na) Habilitação jurídica;\nb) Regularidade fiscal e trabalhista;\nc) Qualificação econômico-financeira;\nd) Qualificação técnica conforme Anexo II.",
  },
  {
    id: "sec7",
    title: "6. DAS DISPOSIÇÕES FINAIS",
    content: "6.1 Os casos omissos serão resolvidos pela autoridade competente com base na Lei 14.133/2021.\n\n6.2 Este Edital e seus Anexos estão disponíveis no PNCP e no sítio eletrônico do órgão.\n\n6.3 Data de publicação: {{DATA_PUBLICACAO}}.",
  },
];

const COMPLETENESS_SCORE = 0.85;
const REPLAY_KEY = "rk_draft_20260608_0907_a4f2";
const GENERATED_AT = "08/06/2026 às 09:07:42";

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  edital_pregao: "Edital de Pregão Eletrônico",
  termo_referencia: "Termo de Referência",
  estudo_tecnico: "Estudo Técnico Preliminar",
  contrato: "Contrato Administrativo",
};

function renderContentWithVariables(content: string): React.ReactNode[] {
  const parts = content.split(/(\{\{[A-Z_]+\}\})/g);
  return parts.map((part, i) => {
    if (/^\{\{[A-Z_]+\}\}$/.test(part)) {
      return (
        <mark key={i} style={{ background: "#fef3c7", color: "#92400e", borderRadius: "3px", padding: "0 3px", fontFamily: "monospace", fontSize: "inherit" }}>
          {part}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function StructuredDraftPreview({ sessionId = "demo", documentType = "edital_pregao", organizationId = 1 }: Props) {
  const completePct = Math.round(COMPLETENESS_SCORE * 100);
  const completenessColor = completePct >= 80 ? "#10b981" : completePct >= 60 ? "#f59e0b" : "#ef4444";
  const docTypeLabel = DOCUMENT_TYPE_LABELS[documentType] ?? documentType;

  return (
    <div style={{ fontFamily: "sans-serif", padding: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>Preview Estruturado do Rascunho</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>Sessão: {sessionId}</span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>Org: {organizationId}</span>
        </div>
      </div>

      {/* Document type header */}
      <div style={{ background: "#dbeafe", border: "1px solid #93c5fd", borderRadius: "0.5rem", padding: "0.625rem 0.875rem", marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: "0.9375rem", fontWeight: 700, color: "#1d4ed8" }}>{docTypeLabel}</span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: "#1e40af" }}>Completude:</span>
          <span style={{ fontSize: "0.875rem", fontWeight: 700, color: completenessColor }}>{completePct}%</span>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          onClick={() => {}}
          style={{ padding: "0.5rem 0.875rem", background: "#1d4ed8", color: "white", border: "none", borderRadius: "0.375rem", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer" }}
        >
          Exportar PDF
        </button>
        <button
          onClick={() => {}}
          style={{ padding: "0.5rem 0.875rem", background: "white", color: "#374151", border: "1px solid #d1d5db", borderRadius: "0.375rem", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer" }}
        >
          Revisar
        </button>
        <button
          onClick={() => {}}
          style={{ padding: "0.5rem 0.875rem", background: "#10b981", color: "white", border: "none", borderRadius: "0.375rem", fontSize: "0.8125rem", fontWeight: 600, cursor: "pointer" }}
        >
          Aprovar
        </button>
      </div>

      {/* Variable legend */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.375rem 0.625rem", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "0.375rem", marginBottom: "1rem", fontSize: "0.75rem", color: "#92400e" }}>
        <mark style={{ background: "#fef3c7", color: "#92400e", borderRadius: "3px", padding: "0 3px", fontFamily: "monospace" }}>{"{{VARIAVEL}}"}</mark>
        <span>= variável pendente de resolução</span>
      </div>

      {/* Document sections */}
      <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
        {MOCK_SECTIONS.map((section, idx) => (
          <div key={section.id} style={{ borderBottom: idx < MOCK_SECTIONS.length - 1 ? "1px solid #e5e7eb" : "none" }}>
            <div style={{ padding: "0.5rem 0.875rem", background: "#f9fafb", borderBottom: "1px solid #f3f4f6" }}>
              <span style={{ fontSize: "0.8125rem", fontWeight: 700, color: "#1d4ed8" }}>{section.title}</span>
            </div>
            <div style={{ padding: "0.625rem 0.875rem", background: "white" }}>
              <p style={{ fontSize: "0.8125rem", color: "#374151", margin: 0, lineHeight: 1.7, whiteSpace: "pre-line" }}>
                {renderContentWithVariables(section.content)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Footer metadata */}
      <div style={{ marginTop: "0.875rem", padding: "0.625rem 0.875rem", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.5rem", display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.75rem", color: "#9ca3af" }}>
        <span>Gerado em: <strong style={{ color: "#6b7280" }}>{GENERATED_AT}</strong></span>
        <span>replayKey: <code style={{ fontFamily: "monospace", color: "#6b7280", fontSize: "0.7rem" }}>{REPLAY_KEY}</code></span>
        <span>Score de completude: <strong style={{ color: completenessColor }}>{completePct}%</strong></span>
      </div>
    </div>
  );
}
