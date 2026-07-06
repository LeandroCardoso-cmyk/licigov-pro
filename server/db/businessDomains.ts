/**
 * Sprint 5.0.1 — Business Domain / Licensing Persistence Repository
 *
 * Persistência real (Drizzle/MySQL) de domínios, workspaces de domínio, módulos
 * licenciados, dependências, feature flags, features da organização, kernel
 * services e navegação. Padrão getDb(): degrada graciosamente sem DB. Multi-tenant.
 */

import { and, asc, eq } from "drizzle-orm";
import { getDb } from "./connection";
import {
  businessDomainsTable,
  domainWorkspacesTable,
  licensedModulesTable,
  moduleDependenciesTable,
  moduleFeatureFlagsTable,
  organizationFeaturesTable,
  kernelServicesTable,
  domainNavigationTable,
} from "../../drizzle/schema";
import type { BusinessDomain } from "../domain/businessDomain";
import type { DomainWorkspace } from "../domain/domainWorkspace";
import type { LicensedModule } from "../domain/licensedModule";
import type { ModuleDependency } from "../domain/moduleDependency";
import type { FeatureFlag } from "../domain/featureFlag";
import type { KernelServiceRecord } from "../domain/cognitiveKernel";

// ─── Business domains (catálogo global) ──────────────────────────────────────

export async function upsertBusinessDomain(domain: BusinessDomain): Promise<BusinessDomain | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(businessDomainsTable).values({
    id: domain.id, code: domain.code, name: domain.name, description: domain.description,
    category: domain.category, active: domain.active ? 1 : 0, version: domain.version,
    dependencies: JSON.stringify(domain.dependencies),
    requiredKernelServices: JSON.stringify(domain.requiredKernelServices),
    supportedWorkflows: JSON.stringify(domain.supportedWorkflows),
    workspaceType: domain.workspaceType, createdAt: domain.createdAt,
  }).onDuplicateKeyUpdate({ set: { name: domain.name, active: domain.active ? 1 : 0, version: domain.version } });
  return domain;
}

export async function listBusinessDomainRows(): Promise<Array<{ id: string; code: string; name: string; category: string; active: boolean }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(businessDomainsTable);
  return rows.map(r => ({ id: r.id, code: r.code, name: r.name, category: r.category, active: r.active === 1 }));
}

// ─── Domain workspaces ───────────────────────────────────────────────────────

export async function insertDomainWorkspace(ws: DomainWorkspace): Promise<DomainWorkspace | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(domainWorkspacesTable).values({
    id: ws.id, organizationId: ws.organizationId, businessDomainId: ws.businessDomainId,
    businessDomainCode: ws.businessDomainCode, workspaceType: ws.workspaceType,
    currentWorkflow: ws.currentWorkflow, activeCopilots: JSON.stringify(ws.activeCopilots),
    activeDocuments: JSON.stringify(ws.activeDocuments), activeTasks: JSON.stringify(ws.activeTasks),
    permissions: JSON.stringify(ws.permissions), correlationId: ws.correlationId, createdAt: ws.createdAt,
  }).onDuplicateKeyUpdate({ set: { currentWorkflow: ws.currentWorkflow } });
  return ws;
}

export async function getDomainWorkspace(organizationId: number, businessDomainCode: string): Promise<{ id: string; businessDomainCode: string; workspaceType: string; currentWorkflow: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(domainWorkspacesTable)
    .where(and(eq(domainWorkspacesTable.organizationId, organizationId), eq(domainWorkspacesTable.businessDomainCode, businessDomainCode)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, businessDomainCode: r.businessDomainCode, workspaceType: r.workspaceType, currentWorkflow: r.currentWorkflow };
}

// ─── Licensed modules ────────────────────────────────────────────────────────

export async function upsertLicensedModule(module: LicensedModule): Promise<LicensedModule | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(licensedModulesTable).values({
    id: module.id, organizationId: module.organizationId, businessDomainCode: module.businessDomainCode,
    plan: module.plan, active: module.active ? 1 : 0, activationDate: module.activationDate,
    expirationDate: module.expirationDate, licensedFeatures: JSON.stringify(module.licensedFeatures),
    correlationId: module.correlationId, createdAt: module.createdAt,
  }).onDuplicateKeyUpdate({ set: { plan: module.plan, active: module.active ? 1 : 0, expirationDate: module.expirationDate } });
  return module;
}

export async function listLicensedModules(organizationId: number): Promise<Array<{ id: string; businessDomainCode: string; plan: string; active: boolean; expirationDate: string | null }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(licensedModulesTable).where(eq(licensedModulesTable.organizationId, organizationId));
  return rows.map(r => ({ id: r.id, businessDomainCode: r.businessDomainCode, plan: r.plan, active: r.active === 1, expirationDate: r.expirationDate ?? null }));
}

export async function getLicensedModule(organizationId: number, businessDomainCode: string): Promise<{ id: string; active: boolean; plan: string; expirationDate: string | null; licensedFeatures: string[] } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(licensedModulesTable)
    .where(and(eq(licensedModulesTable.organizationId, organizationId), eq(licensedModulesTable.businessDomainCode, businessDomainCode)))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  let features: string[] = [];
  try { features = r.licensedFeatures ? JSON.parse(r.licensedFeatures) : []; } catch { features = []; }
  return { id: r.id, active: r.active === 1, plan: r.plan, expirationDate: r.expirationDate ?? null, licensedFeatures: features };
}

export async function setModuleActive(organizationId: number, businessDomainCode: string, active: boolean): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(licensedModulesTable).set({ active: active ? 1 : 0 })
    .where(and(eq(licensedModulesTable.organizationId, organizationId), eq(licensedModulesTable.businessDomainCode, businessDomainCode)));
  return true;
}

// ─── Module dependencies ─────────────────────────────────────────────────────

export async function upsertModuleDependency(dep: ModuleDependency): Promise<ModuleDependency | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(moduleDependenciesTable).values({
    id: dep.id, dependentCode: dep.dependentCode, kind: dep.kind,
    dependsOn: dep.dependsOn, required: dep.required ? 1 : 0, createdAt: dep.createdAt,
  }).onDuplicateKeyUpdate({ set: { required: dep.required ? 1 : 0 } });
  return dep;
}

export async function listDependencies(dependentCode: string): Promise<Array<{ id: string; kind: string; dependsOn: string; required: boolean }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(moduleDependenciesTable).where(eq(moduleDependenciesTable.dependentCode, dependentCode));
  return rows.map(r => ({ id: r.id, kind: r.kind, dependsOn: r.dependsOn, required: r.required === 1 }));
}

// ─── Feature flags ───────────────────────────────────────────────────────────

export async function upsertFeatureFlag(flag: FeatureFlag): Promise<FeatureFlag | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(moduleFeatureFlagsTable).values({
    id: flag.id, organizationId: flag.organizationId, businessDomainCode: flag.businessDomainCode,
    featureKey: flag.featureKey, enabled: flag.enabled ? 1 : 0, rolloutStrategy: flag.rolloutStrategy,
    correlationId: flag.correlationId, createdAt: flag.createdAt,
  }).onDuplicateKeyUpdate({ set: { enabled: flag.enabled ? 1 : 0, rolloutStrategy: flag.rolloutStrategy } });
  return flag;
}

export async function getFeatureFlag(organizationId: number, featureKey: string): Promise<{ enabled: boolean; rolloutStrategy: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(moduleFeatureFlagsTable)
    .where(and(eq(moduleFeatureFlagsTable.organizationId, organizationId), eq(moduleFeatureFlagsTable.featureKey, featureKey)))
    .limit(1);
  if (rows.length === 0) return null;
  return { enabled: rows[0].enabled === 1, rolloutStrategy: rows[0].rolloutStrategy };
}

export async function listFeatureFlags(organizationId: number): Promise<Array<{ id: string; featureKey: string; enabled: boolean; rolloutStrategy: string; businessDomainCode: string | null }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(moduleFeatureFlagsTable).where(eq(moduleFeatureFlagsTable.organizationId, organizationId));
  return rows.map(r => ({ id: r.id, featureKey: r.featureKey, enabled: r.enabled === 1, rolloutStrategy: r.rolloutStrategy, businessDomainCode: r.businessDomainCode ?? null }));
}

// ─── Kernel services ──────────────────────────────────────────────────────────

export async function upsertKernelService(rec: KernelServiceRecord): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(kernelServicesTable).values({
    id: rec.id, serviceId: rec.serviceId, name: rec.name, category: rec.category,
    active: rec.active ? 1 : 0, createdAt: rec.createdAt,
  }).onDuplicateKeyUpdate({ set: { active: rec.active ? 1 : 0 } });
}

export async function listKernelServiceRows(): Promise<Array<{ serviceId: string; name: string; category: string; active: boolean }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(kernelServicesTable);
  return rows.map(r => ({ serviceId: r.serviceId, name: r.name, category: r.category, active: r.active === 1 }));
}

// ─── Domain navigation ────────────────────────────────────────────────────────

export async function upsertNavigationEntry(params: {
  id: string; organizationId: number; businessDomainCode: string; visible: boolean; sortOrder: number;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(domainNavigationTable).values({
    id: params.id, organizationId: params.organizationId, businessDomainCode: params.businessDomainCode,
    visible: params.visible ? 1 : 0, sortOrder: params.sortOrder,
  }).onDuplicateKeyUpdate({ set: { visible: params.visible ? 1 : 0, sortOrder: params.sortOrder } });
}

export async function listNavigation(organizationId: number): Promise<Array<{ businessDomainCode: string; visible: boolean; sortOrder: number }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(domainNavigationTable)
    .where(eq(domainNavigationTable.organizationId, organizationId))
    .orderBy(asc(domainNavigationTable.sortOrder));
  return rows.map(r => ({ businessDomainCode: r.businessDomainCode, visible: r.visible === 1, sortOrder: r.sortOrder }));
}

// ─── Organization features ────────────────────────────────────────────────────

export async function upsertOrganizationFeature(params: {
  id: string; organizationId: number; featureKey: string; enabled: boolean; source: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(organizationFeaturesTable).values({
    id: params.id, organizationId: params.organizationId, featureKey: params.featureKey,
    enabled: params.enabled ? 1 : 0, source: params.source,
  }).onDuplicateKeyUpdate({ set: { enabled: params.enabled ? 1 : 0 } });
}
