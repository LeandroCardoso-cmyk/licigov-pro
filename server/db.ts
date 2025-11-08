import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, 
  users,
  processes,
  documents,
  editalParameters,
  processCollaborators,
  activityLogs,
  InsertProcess,
  InsertDocument,
  InsertEditalParameter,
  InsertProcessCollaborator,
  InsertActivityLog
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Process queries
export async function createProcess(process: InsertProcess) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(processes).values(process);
  return result;
}

export async function getProcessesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(processes)
    .where(eq(processes.ownerId, userId))
    .orderBy(desc(processes.updatedAt));
}

export async function getProcessById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(processes).where(eq(processes.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateProcessStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(processes).set({ status: status as any }).where(eq(processes.id, id));
}

// Document queries
export async function createDocument(document: InsertDocument) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(documents).values(document);
  return result;
}

export async function getDocumentsByProcess(processId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(documents)
    .where(eq(documents.processId, processId))
    .orderBy(desc(documents.createdAt));
}

export async function getDocumentByProcessAndType(processId: number, type: string) {
  const db = await getDb();
  if (!db) return undefined;
  

  const result = await db
    .select()
    .from(documents)
    .where(and(
      eq(documents.processId, processId),
      eq(documents.type, type as any)
    ))
    .orderBy(desc(documents.version))
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

// Edital parameters queries
export async function upsertEditalParameters(params: InsertEditalParameter) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(editalParameters).values(params).onDuplicateKeyUpdate({
    set: {
      modalidade: params.modalidade,
      formato: params.formato,
      criterioJulgamento: params.criterioJulgamento,
      regimeContratacao: params.regimeContratacao,
    },
  });
}

export async function getEditalParametersByProcess(processId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db
    .select()
    .from(editalParameters)
    .where(eq(editalParameters.processId, processId))
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

// Activity log queries
export async function createActivityLog(log: InsertActivityLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(activityLogs).values(log);
}

export async function getActivityLogsByProcess(processId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(activityLogs)
    .where(eq(activityLogs.processId, processId))
    .orderBy(desc(activityLogs.createdAt));
}

// Collaborator queries
export async function addCollaborator(collaborator: InsertProcessCollaborator) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(processCollaborators).values(collaborator);
}

export async function getCollaboratorsByProcess(processId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(processCollaborators)
    .where(eq(processCollaborators.processId, processId));
}
