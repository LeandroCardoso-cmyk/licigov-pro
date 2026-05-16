import { eq, and, asc, desc } from "drizzle-orm";
import {
  platforms, platformTemplates, platformChecklists, platformPublications, processes,
} from "../../drizzle/schema";
import { getDb } from "./connection";
import { getProcessById } from "./processes";

export async function getPlatforms() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(platforms).where(eq(platforms.isActive, true)).orderBy(asc(platforms.displayOrder));
}

export async function getPlatformById(platformId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(platforms).where(eq(platforms.id, platformId)).limit(1);
  return result[0] || null;
}

export async function getPlatformBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(platforms).where(eq(platforms.slug, slug)).limit(1);
  return result[0] || null;
}

export async function getPlatformTemplates(platformId: number, documentType?: "etp" | "tr" | "dfd" | "edital") {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [
    eq(platformTemplates.platformId, platformId),
    eq(platformTemplates.isActive, true),
  ];
  if (documentType) conditions.push(eq(platformTemplates.documentType, documentType) as any);
  return await db.select().from(platformTemplates).where(and(...conditions));
}

export async function getPlatformChecklist(platformId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(platformChecklists)
    .where(eq(platformChecklists.platformId, platformId))
    .orderBy(asc(platformChecklists.stepNumber));
}

export async function updateProcessPlatform(processId: number, platformId: number | null) {
  const db = await getDb();
  if (!db) return null;
  await db.update(processes).set({ platformId, updatedAt: new Date() }).where(eq(processes.id, processId));
  return await getProcessById(processId);
}

export async function createPlatformPublication(data: {
  processId: number;
  platformId: number;
  externalId?: string;
  externalUrl?: string;
  status?: "draft" | "published" | "scheduled" | "failed" | "cancelled" | "closed";
  scheduledFor?: Date;
  metadata?: Record<string, any>;
}) {
  const db = await getDb();
  if (!db) return null;
  return await db.insert(platformPublications).values({
    processId: data.processId,
    platformId: data.platformId,
    externalId: data.externalId || null,
    externalUrl: data.externalUrl || null,
    status: data.status || "draft",
    scheduledFor: data.scheduledFor || null,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
  });
}

export async function getProcessPublications(processId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(platformPublications)
    .where(eq(platformPublications.processId, processId))
    .orderBy(desc(platformPublications.createdAt));
}

export async function createChecklistStep(data: {
  platformId: number;
  stepNumber: number;
  title: string;
  description?: string;
  category?: string;
  fields?: any;
  requiredDocuments?: any;
  isOptional?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(platformChecklists).values(data as any);
  return result.insertId;
}

export async function updateChecklistStep(
  stepId: number,
  data: {
    title?: string;
    description?: string;
    category?: string;
    fields?: any;
    requiredDocuments?: any;
    isOptional?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(platformChecklists).set(data as any).where(eq(platformChecklists.id, stepId));
  return { success: true };
}

export async function deleteChecklistStep(stepId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(platformChecklists).where(eq(platformChecklists.id, stepId));
  return { success: true };
}

export async function reorderChecklistStep(stepId: number, direction: "up" | "down") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [currentStep] = await db.select().from(platformChecklists).where(eq(platformChecklists.id, stepId)).limit(1);
  if (!currentStep) throw new Error("Passo não encontrado");

  const targetStepNumber = direction === "up" ? currentStep.stepNumber - 1 : currentStep.stepNumber + 1;

  const [targetStep] = await db
    .select()
    .from(platformChecklists)
    .where(and(eq(platformChecklists.platformId, currentStep.platformId), eq(platformChecklists.stepNumber, targetStepNumber)))
    .limit(1);

  if (!targetStep) throw new Error(direction === "up" ? "Já é o primeiro passo" : "Já é o último passo");

  await db.update(platformChecklists).set({ stepNumber: targetStepNumber }).where(eq(platformChecklists.id, currentStep.id));
  await db.update(platformChecklists).set({ stepNumber: currentStep.stepNumber }).where(eq(platformChecklists.id, targetStep.id));
  return { success: true };
}

export async function updatePlatformInstructions(
  platformId: number,
  instructions: { general?: string; etp?: string; tr?: string; dfd?: string; edital?: string }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const platform = await getPlatformById(platformId);
  if (!platform) throw new Error("Platform not found");
  const updatedConfig = { ...((platform.config as any) || {}), instructions };
  await db.update(platforms).set({ config: updatedConfig as any }).where(eq(platforms.id, platformId));
  return { success: true };
}

export async function updatePublicationStatus(
  publicationId: number,
  status: "draft" | "published" | "scheduled" | "failed" | "cancelled" | "closed",
  data?: {
    externalId?: string;
    externalUrl?: string;
    publishedAt?: Date;
    closedAt?: Date;
    errorMessage?: string;
    apiResponse?: Record<string, any>;
  }
) {
  const db = await getDb();
  if (!db) return null;
  const updateData: any = { status, updatedAt: new Date() };
  if (data?.externalId) updateData.externalId = data.externalId;
  if (data?.externalUrl) updateData.externalUrl = data.externalUrl;
  if (data?.publishedAt) updateData.publishedAt = data.publishedAt;
  if (data?.closedAt) updateData.closedAt = data.closedAt;
  if (data?.errorMessage) updateData.errorMessage = data.errorMessage;
  if (data?.apiResponse) updateData.apiResponse = JSON.stringify(data.apiResponse);
  await db.update(platformPublications).set(updateData).where(eq(platformPublications.id, publicationId));
  const rows = await db.select().from(platformPublications).where(eq(platformPublications.id, publicationId)).limit(1);
  return rows[0] || null;
}
