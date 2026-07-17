/**
 * RC-X.1 — Institutional Experience Framework · Navigation Builder (Part 5 + Part 12).
 *
 * Monta DINAMICAMENTE Sidebar, Top Navigation, Quick Actions, Breadcrumbs e Menus a partir dos
 * workspaces resolvidos — NUNCA hardcoded. Cada item de navegação carrega EXPLAINABILITY (por que
 * apareceu, qual capacidade habilitou, qual módulo registrou, qual workspace, qual tenant).
 * Determinístico.
 */

import type { InstitutionContext } from "./institutionContext";
import type { ResolvedWorkspace } from "./workspace";

/** Explicação de um item de navegação (Part 12). */
export interface NavigationExplanation {
  readonly reason: string;
  /** Capacidade que habilitou o item. */
  readonly capability: string;
  /** Módulo que registrou o workspace. */
  readonly module: string;
  /** Workspace ao qual o item pertence. */
  readonly workspace: string;
  /** Tenant que autorizou. */
  readonly tenantId: number;
}

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly route: string;
  readonly category: string;
  readonly workspaceId: string;
  readonly explanation: NavigationExplanation;
}

export interface Breadcrumb {
  readonly label: string;
  readonly route: string;
}

export interface NavigationModel {
  readonly sidebar: readonly NavigationItem[];
  readonly topNav: readonly NavigationItem[];
  readonly quickActions: readonly NavigationItem[];
  readonly menus: readonly NavigationItem[];
}

function explanationFor(rw: ResolvedWorkspace, context: InstitutionContext): NavigationExplanation {
  return {
    reason: rw.reason,
    capability: rw.enabledBy[0] ?? rw.workspace.requiredCapabilities[0] ?? "",
    module: rw.workspace.module,
    workspace: rw.workspace.id,
    tenantId: context.tenantId,
  };
}

function toItem(rw: ResolvedWorkspace, context: InstitutionContext): NavigationItem {
  return {
    id: `nav:${rw.workspace.id}`,
    label: rw.workspace.title,
    icon: rw.workspace.icon,
    route: rw.workspace.routes[0] ?? `/${rw.workspace.id}`,
    category: rw.workspace.category,
    workspaceId: rw.workspace.id,
    explanation: explanationFor(rw, context),
  };
}

/**
 * Monta o modelo de navegação a partir dos workspaces resolvidos. Apenas workspaces HABILITADOS
 * entram na navegação. Determinístico (ordenação estável por id do workspace).
 */
export function buildNavigation(resolved: readonly ResolvedWorkspace[], context: InstitutionContext): NavigationModel {
  const enabled = [...resolved].filter(r => r.enabled).sort((a, b) => a.workspace.id.localeCompare(b.workspace.id));

  const sidebar = enabled.map(rw => toItem(rw, context));
  // Top nav: workspaces operacionais e de contrato em destaque.
  const topNav = enabled.filter(rw => rw.workspace.category === "operacional" || rw.workspace.category === "contrato").map(rw => toItem(rw, context));
  // Quick actions: uma por ação habilitada de cada workspace.
  const quickActions: NavigationItem[] = [];
  for (const rw of enabled) {
    for (const action of [...rw.workspace.actions].sort((a, b) => a.id.localeCompare(b.id))) {
      if (rw.enabledActions.includes(action.id)) {
        quickActions.push({
          id: `qa:${rw.workspace.id}:${action.id}`,
          label: action.label,
          icon: rw.workspace.icon,
          route: rw.workspace.routes[0] ?? `/${rw.workspace.id}`,
          category: rw.workspace.category,
          workspaceId: rw.workspace.id,
          explanation: { ...explanationFor(rw, context), capability: action.capability, reason: `Ação habilitada pela capacidade "${action.capability}".` },
        });
      }
    }
  }
  const menus = sidebar;

  return { sidebar, topNav, quickActions, menus };
}

/** Monta breadcrumbs para uma rota, a partir do modelo de navegação. Determinístico. */
export function buildBreadcrumbs(model: NavigationModel, route: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ label: "Início", route: "/" }];
  const item = model.sidebar.find(i => i.route === route);
  if (item) crumbs.push({ label: item.label, route: item.route });
  return crumbs;
}
