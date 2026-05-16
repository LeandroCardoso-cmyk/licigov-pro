export interface LegalOpinion {
  id: number;
  title: string;
  status: string;
  conclusion: string | null;
  opinion: string | null;
  legalQuestion: string;
  context: string | null;
  sourceType: string;
  requestedBy: number;
  createdAt: Date | string;
  reviewedAt: Date | string | null;
  citedArticles: unknown;
  jurisprudence: unknown;
  requiredSignatures: number;
  signatureId?: number | null;
  isTemplate?: boolean;
}
