export type ProcessStatus =
  | "em_dfd"
  | "em_etp"
  | "em_tr"
  | "em_edital"
  | "concluido";

export interface Process {
  id: number;
  name: string;
  description?: string | null;
  object?: string | null;
  status: string;
  estimatedValue?: number | null;
  modality?: string | null;
  category?: string | null;
  platformId?: number | null;
  ownerId: number;
  updatedAt: Date;
  createdAt: Date;
  platform?: { name: string; description?: string | null; websiteUrl?: string | null } | null;
}

export interface ProcessDocument {
  id: number;
  processId: number;
  type: string;
  content: string | null;
  sourceType: "ai" | "upload";
  s3Key: string | null;
  fileUrl: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: number;
  name: string | null;
  email: string | null;
  role: "user" | "admin";
  theme?: "light" | "dark" | "system" | null;
}

export interface Notification {
  id: number;
  userId: number;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
}

export type ID = number;

export type ApiError = { message: string };
