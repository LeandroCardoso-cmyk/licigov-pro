import { vi } from "vitest";
import type { User, Process, Document } from "../../../drizzle/schema";

export const mockUser: User = {
  id: 1,
  openId: "open-id-001",
  name: "Usuário Teste",
  email: "teste@licigov.com.br",
  loginMethod: "email",
  role: "user",
  theme: "light",
  passwordHash: "$2b$12$hashedpassword",
  signaturePassword: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  lastSignedIn: new Date("2025-01-01"),
};

export const mockAdmin: User = {
  ...mockUser,
  id: 2,
  openId: "open-id-admin",
  role: "admin",
  email: "admin@licigov.com.br",
};

export const mockOtherUser: User = {
  ...mockUser,
  id: 99,
  openId: "open-id-other",
  email: "other@licigov.com.br",
};

export const mockProcess: Process = {
  id: 10,
  name: "Pregão Eletrônico 001/2025",
  description: "Aquisição de equipamentos de TI",
  object: "Computadores desktop para uso administrativo",
  estimatedValue: 5000000,
  modality: "pregao_eletronico",
  category: "compras",
  platformId: null,
  status: "em_dfd",
  ownerId: 1,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const mockDocument: Document = {
  id: 100,
  processId: 10,
  type: "dfd",
  content: "# DFD\n\nConteúdo do Documento de Formalização de Demanda.",
  sourceType: "ai",
  s3Key: null,
  fileUrl: null,
  version: 1,
  createdBy: 1,
  documentStatus: "draft",
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
};

export const mockUploadedDocument: Document = {
  ...mockDocument,
  id: 101,
  type: "tr",
  content: null,
  sourceType: "upload",
  s3Key: "processes/10/tr/1234567890_termo.pdf",
  fileUrl: "https://s3.example.com/processes/10/tr/1234567890_termo.pdf",
};

export function makeContext(user: User | null = null) {
  return {
    user,
    req: {
      headers: {},
      ip: "127.0.0.1",
      secure: false,
      protocol: "http",
      hostname: "localhost",
    } as any,
    res: {
      cookie: vi.fn(),
      clearCookie: vi.fn(),
      setHeader: vi.fn(),
    } as any,
  };
}
