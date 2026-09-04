/**
 * Guarda de regressão do dark mode (OBJ 4): os componentes autenticados migrados
 * NÃO podem reintroduzir cores neutras hardcoded (bg-white, bg-gray-*, text-gray-*,
 * border-gray-*, text-black) — devem usar tokens semânticos (bg-card, bg-muted,
 * text-foreground, text-muted-foreground, border-border, border-input).
 *
 * Cores FUNCIONAIS (green/red/amber/indigo/…) são preservadas e não entram aqui.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Vitest roda com root no diretório do repositório (ver vitest.config.ts).
const ROOT = process.cwd();

// className="..." apenas — o padrão neutro proibido.
const BANNED = /\b(?:bg-white|bg-gray-\d{2,3}|text-gray-\d{2,3}|border-gray-\d{2,3}|text-black)\b/;

const MIGRATED_FILES = [
  "client/src/components/department-operation/DepartmentOperationHome.tsx",
  "client/src/components/department-operation/OperationalDashboard.tsx",
  "client/src/components/department-operation/OperationalRecommendations.tsx",
  "client/src/components/department-operation/OperationalIndicators.tsx",
  "client/src/components/department-operation/OperationalTimeline.tsx",
  "client/src/components/department-operation/OperationalInbox.tsx",
  "client/src/components/department-operation/OperationalMonitoringPanel.tsx",
  "client/src/components/department-operation/OperationalCalendar.tsx",
  "client/src/components/department-operation/LegacyImportWizard.tsx",
  "client/src/components/department-operation/OperationRecordWizard.tsx",
  "client/src/components/department-operation/labels.ts",
  "client/src/components/tirar-duvidas/TirarDuvidasHome.tsx",
  "client/src/pages/CentroOperacoes.tsx",
  // PR A.1
  "client/src/pages/EsqueciSenha.tsx",
  "client/src/pages/RedefinirSenha.tsx",
  "client/src/pages/AceitarConvite.tsx",
  "client/src/pages/Usuarios.tsx",
  "client/src/pages/AdminOrganizacoes.tsx",
  "client/src/pages/BemVindo.tsx",
  // PR B — telas canônicas expostas (contraste dark mode)
  "client/src/pages/ProcessoLicitatorio.tsx",
  "client/src/components/procurement/ProcessoLicitatorioHome.tsx",
  "client/src/components/procurement/NovoProcessoWizard.tsx",
  // PR B (homologação DFD) — os 7 workspaces canônicos expostos
  "client/src/components/procurement/ProcessOverview.tsx",
  "client/src/components/procurement/DFDWorkspace.tsx",
  "client/src/components/procurement/PesquisaPrecosWorkspace.tsx",
  "client/src/components/procurement/ItemIntelligenceWorkspace.tsx",
  "client/src/components/procurement/ETPWorkspace.tsx",
  "client/src/components/procurement/TRWorkspace.tsx",
  "client/src/components/procurement/EditalWorkspace.tsx",
  // PR B.1 — painel compartilhado de documentos oficiais (DOCX/PDF/Imprimir)
  "client/src/components/documents/OfficialDocumentPanel.tsx",
  // ── V1 UI/UX Stabilization — telas V1 alcançáveis migradas para tokens semânticos ──
  // Dashboard executivo (novo) + os três domínios de operador que ainda usavam neutros.
  "client/src/pages/ExecutiveDashboard.tsx",
  // Parecer Jurídico (/parecer) — árvore legal-opinion alcançável
  "client/src/components/legal-opinion/LegalOpinionHome.tsx",
  "client/src/components/legal-opinion/RequestContextPanel.tsx",
  "client/src/components/legal-opinion/InstitutionalInbox.tsx",
  "client/src/components/legal-opinion/LegalOpinionEditor.tsx",
  "client/src/components/legal-opinion/LegalOpinionViewer.tsx",
  "client/src/components/legal-opinion/OpinionHistory.tsx",
  "client/src/components/legal-opinion/LawyerDashboard.tsx",
  "client/src/components/legal-opinion/SignaturePanel.tsx",
  "client/src/components/legal-opinion/TimelinePanel.tsx",
  "client/src/components/legal-opinion/labels.ts",
  // Contratação Direta (/contratacao-direta) — árvore direct-procurement alcançável
  "client/src/components/direct-procurement/DirectProcurementHome.tsx",
  "client/src/components/direct-procurement/DirectProcurementOverview.tsx",
  "client/src/components/direct-procurement/NewDirectProcurementWizard.tsx",
  "client/src/components/direct-procurement/LegalBasisWorkspace.tsx",
  "client/src/components/direct-procurement/NeedCharacterizationWorkspace.tsx",
  "client/src/components/direct-procurement/ProposalCollectionWorkspace.tsx",
  "client/src/components/direct-procurement/ContractJustificationWorkspace.tsx",
  "client/src/components/direct-procurement/PriceJustificationWorkspace.tsx",
  "client/src/components/direct-procurement/RequiredDocumentsWorkspace.tsx",
  "client/src/components/direct-procurement/RatificationWorkspace.tsx",
  "client/src/components/direct-procurement/PublicationWorkspace.tsx",
  "client/src/components/direct-procurement/TimelinePanel.tsx",
  "client/src/components/direct-procurement/labels.ts",
  // Contratos (/contratos) — árvore contract-workspace alcançável
  "client/src/components/contract-workspace/ContractsHome.tsx",
  "client/src/components/contract-workspace/ContractOverview.tsx",
  "client/src/components/contract-workspace/ContractWorkspace.tsx",
  "client/src/components/contract-workspace/ContractEditor.tsx",
  "client/src/components/contract-workspace/AddendumWorkspace.tsx",
  "client/src/components/contract-workspace/ApostilleWorkspace.tsx",
  "client/src/components/contract-workspace/OccurrenceWorkspace.tsx",
  "client/src/components/contract-workspace/DocumentsWorkspace.tsx",
  "client/src/components/contract-workspace/ImportedContracts.tsx",
  "client/src/components/contract-workspace/CopilotPanel.tsx",
  "client/src/components/contract-workspace/TimelinePanel.tsx",
  "client/src/components/contract-workspace/labels.ts",
  // Processo Licitatório (/processos) — painel de item (drawer) alcançável
  "client/src/components/procurement/ProcurementItemPanel.tsx",
];

describe("Dark mode · tokens semânticos nos componentes autenticados", () => {
  it.each(MIGRATED_FILES)("%s não usa cores neutras hardcoded", (rel) => {
    const source = readFileSync(path.join(ROOT, rel), "utf8");
    const offending = source
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((l) => BANNED.test(l.line));
    expect(offending, `Cores neutras hardcoded encontradas em ${rel}:\n${offending.map((o) => `  L${o.n}: ${o.line}`).join("\n")}`).toEqual([]);
  });
});
