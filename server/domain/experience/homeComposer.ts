/**
 * RC-X.1 — Institutional Experience Framework · Home Composer (Part 6).
 *
 * Monta DINAMICAMENTE a Home institucional (Widgets, Cards, Quick Actions, Recentes, Favoritos,
 * Workspaces) com base no InstitutionContext e nos workspaces resolvidos — NUNCA hardcoded.
 * Determinístico. Sem UX definitiva.
 */

import type { InstitutionContext } from "./institutionContext";
import type { ResolvedWorkspace } from "./workspace";
import type { NavigationItem } from "./navigationBuilder";

export interface HomeCard {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly workspaceId: string;
  readonly route: string;
  readonly icon: string;
}

export interface HomeWidget {
  readonly id: string;
  readonly kind: "workspaces" | "recentes" | "favoritos" | "quick_actions" | "institution";
  readonly title: string;
  readonly items: readonly string[];
}

export interface HomeModel {
  readonly institution: { readonly name: string; readonly tenantType: string; readonly branding: InstitutionContext["branding"] };
  readonly widgets: readonly HomeWidget[];
  readonly cards: readonly HomeCard[];
  readonly quickActions: readonly NavigationItem[];
  readonly recentes: readonly string[];
  readonly favoritos: readonly string[];
  readonly workspaces: readonly string[];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Compõe a Home a partir do contexto e dos workspaces habilitados. Recentes/Favoritos derivam do
 * contexto (metadata.recentRoutes / workspaceIds), de forma determinística.
 */
export function composeHome(
  context: InstitutionContext,
  resolved: readonly ResolvedWorkspace[],
  quickActions: readonly NavigationItem[] = [],
): HomeModel {
  const enabled = [...resolved].filter(r => r.enabled).sort((a, b) => a.workspace.id.localeCompare(b.workspace.id));
  const workspaceIds = enabled.map(rw => rw.workspace.id);

  const cards: HomeCard[] = enabled.map(rw => ({
    id: `card:${rw.workspace.id}`,
    title: rw.workspace.title,
    description: rw.workspace.description,
    workspaceId: rw.workspace.id,
    route: rw.workspace.routes[0] ?? `/${rw.workspace.id}`,
    icon: rw.workspace.icon,
  }));

  const recentes = asStringArray(context.metadata["recentRoutes"]).slice(0, 5);
  const favoritos = [...context.workspaceIds].filter(id => workspaceIds.includes(id)).sort((a, b) => a.localeCompare(b));

  const widgets: HomeWidget[] = [
    { id: "widget:institution", kind: "institution", title: context.institutionName, items: [context.tenantType] },
    { id: "widget:workspaces", kind: "workspaces", title: "Ambientes de trabalho", items: workspaceIds },
    { id: "widget:favoritos", kind: "favoritos", title: "Favoritos", items: favoritos },
    { id: "widget:recentes", kind: "recentes", title: "Recentes", items: recentes },
    { id: "widget:quick_actions", kind: "quick_actions", title: "Ações rápidas", items: quickActions.map(q => q.id) },
  ];

  return {
    institution: { name: context.institutionName, tenantType: context.tenantType, branding: context.branding },
    widgets, cards, quickActions, recentes, favoritos, workspaces: workspaceIds,
  };
}
