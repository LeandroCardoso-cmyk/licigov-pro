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
