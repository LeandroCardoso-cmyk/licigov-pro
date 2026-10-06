/**
 * Registro dos ports do módulo de Modelos Institucionais + flag tenant-scoped (Lane C).
 *
 * A integration branch chama `configureTemplateWorkflowPorts` na inicialização com os adapters reais (repositório da
 * Lane A, composer da Lane B). Enquanto não configurado, TODAS as operações falham fechado com `PORTS_NOT_CONFIGURED`
 * (nunca há fallback silencioso nem implementação paralela).
 */
import { randomBytes } from "crypto";
import { isFeatureEnabled } from "../featureFlagService";
import { TemplateWorkflowError } from "./errors";
import type { ClockPort, IdPort, TemplatesFlagPort, TemplateWorkflowPorts } from "./ports";

/** Nome da flag no padrão do repositório (`FF_*`, mesmo mecanismo plataforma + override por tenant). Default OFF. */
export const FF_INSTITUTIONAL_TEMPLATES_V1 = "FF_INSTITUTIONAL_TEMPLATES_V1";

let configured: TemplateWorkflowPorts | null = null;

export function configureTemplateWorkflowPorts(ports: TemplateWorkflowPorts): void { configured = ports; }
export function resetTemplateWorkflowPorts(): void { configured = null; }
export function templateWorkflowPortsConfigured(): boolean { return configured !== null; }

export function getTemplateWorkflowPorts(): TemplateWorkflowPorts {
  if (!configured) throw new TemplateWorkflowError("PORTS_NOT_CONFIGURED", "o módulo de Modelos Institucionais ainda não está integrado (persistência/composição indisponíveis)");
  return configured;
}

/**
 * Flag da plataforma (`featureFlagService`): tenant-scoped, fail-closed e default OFF. Esta lane NÃO liga a flag e NÃO
 * cria rollout percentual; a integração deve operá-la sempre como ligado/desligado por organização (percentage = 100).
 */
export function platformTemplatesFlagPort(): TemplatesFlagPort {
  return { isEnabled: (organizationId) => isFeatureEnabled(FF_INSTITUTIONAL_TEMPLATES_V1, organizationId) };
}

export const systemClock: ClockPort = { now: () => new Date().toISOString() };

/** ids `varchar(24)`: prefixo de 2 letras + 20 hex aleatórios. */
export const randomIds: IdPort = { newId: (prefix) => `${prefix}${randomBytes(10).toString("hex")}` };
