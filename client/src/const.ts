export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** Identidade institucional centralizada (evita "LiciGov Pro" espalhado por dezenas de componentes). */
export const APP_TITLE = import.meta.env.VITE_APP_TITLE || "LiciGov Pro";
/** Nome curto (sidebar recolhido, contextos estreitos). */
export const APP_SHORT_NAME = "LiciGov";
/** Subtítulo institucional — usar só onde há espaço (login, institucional, configurações). */
export const APP_DESCRIPTION = "Sistema Operacional Cognitivo para Licitações Públicas";

export const APP_LOGO = "/logo-original-transparent.png";

/** PR A.1 — localStorage: organização selecionada pelo admin de plataforma (ver main.tsx). */
export const SELECTED_ORGANIZATION_ID_STORAGE_KEY = "licigov:selectedOrganizationId";
