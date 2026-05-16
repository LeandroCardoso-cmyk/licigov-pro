export interface DirectContractLegalArticle {
  article: string;
  inciso?: string | null;
  description?: string | null;
  examples?: unknown;
}

export interface DirectContractData {
  id: number;
  number: string;
  year: number | string;
  type: string;
  status: string;
  object: string;
  justification: string;
  value: number;
  createdAt: Date | string;
  mode?: string | null;
  executionDeadline?: number | null;
  supplierName?: string | null;
  supplierCNPJ?: string | null;
  supplierAddress?: string | null;
  supplierContact?: string | null;
  platformId?: number | null;
  legalArticle?: DirectContractLegalArticle | null;
}
