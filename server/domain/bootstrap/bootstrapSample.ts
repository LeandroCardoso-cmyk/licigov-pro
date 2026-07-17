/**
 * RC-X.2 — Institutional Bootstrap Framework · Amostra estrutural.
 *
 * Registro de exemplo com os subsistemas institucionais padrão, formando o pipeline canônico
 * (Authentication → Institution Context → Corpus/Package/Capability/Workspace/Navigation/Home/
 * Copilot/Business Resolution → Ready). Demonstra a EXTENSIBILIDADE (Part 11). Determinístico.
 * Nenhuma regra de negócio, nenhuma IA — initializers são declarativos.
 */

import { createBootstrapRegistry, registerSubsystem, type BootstrapRegistry, type RegisterSubsystemParams } from "./bootstrapRegistry";
import { createBootstrapKernel, type BootstrapKernel } from "./bootstrapKernel";

/** Subsistemas institucionais padrão e suas dependências. */
export const SAMPLE_SUBSYSTEMS: RegisterSubsystemParams[] = [
  { id: "authentication", name: "Authentication", description: "Resolução de autenticação (estrutural).", dependencies: [] },
  { id: "institution_context", name: "Institution Context", description: "Resolução do contexto institucional.", dependencies: ["authentication"] },
  { id: "corpus_resolution", name: "Corpus Resolution", description: "Resolução dos corpora ativos.", dependencies: ["institution_context"] },
  { id: "package_resolution", name: "Package Resolution", description: "Resolução dos pacotes de corpus.", dependencies: ["corpus_resolution"] },
  { id: "capability_resolution", name: "Capability Resolution", description: "Resolução das capacidades.", dependencies: ["institution_context"] },
  { id: "workspace_resolution", name: "Workspace Resolution", description: "Resolução dos workspaces.", dependencies: ["capability_resolution"] },
  { id: "navigation_resolution", name: "Navigation Resolution", description: "Geração da navegação.", dependencies: ["workspace_resolution"] },
  { id: "home_resolution", name: "Home Resolution", description: "Composição da home.", dependencies: ["navigation_resolution"] },
  { id: "copilot_resolution", name: "Copilot Resolution", description: "Preparação do copiloto (sem IA).", dependencies: ["capability_resolution"] },
  { id: "business_resolution", name: "Business Resolution", description: "Preparação dos business domains.", dependencies: ["workspace_resolution", "package_resolution"] },
  { id: "ready", name: "Ready", description: "Plataforma pronta.", dependencies: ["home_resolution", "copilot_resolution", "business_resolution"] },
];

export function sampleBootstrapRegistry(extra: RegisterSubsystemParams[] = []): BootstrapRegistry {
  let reg = createBootstrapRegistry();
  for (const s of [...SAMPLE_SUBSYSTEMS, ...extra]) reg = registerSubsystem(reg, s);
  return reg;
}

export function sampleBootstrapKernel(extra: RegisterSubsystemParams[] = []): BootstrapKernel {
  return createBootstrapKernel(sampleBootstrapRegistry(extra));
}
