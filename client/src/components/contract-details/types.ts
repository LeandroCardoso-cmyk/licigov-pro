export interface ContractData {
  id: number;
  number: string;
  year: number | string;
  status: string;
  object: string;
  type: string;
  value: number;
  currentValue: number;
  startDate: Date | string;
  endDate: Date | string;
  autoRenewal?: boolean | null;
  maxRenewals?: number | null;
  contractorName: string;
  contractorCNPJ?: string | null;
  contractorAddress?: string | null;
  contractorContact?: string | null;
  fiscalUserName?: string | null;
  notes?: string | null;
}

export interface Amendment {
  id: number;
  type: string;
  createdAt: Date | string;
  justification: string;
  newEndDate?: Date | string | null;
  valueChange?: number | null;
}

export interface Apostille {
  id: number;
  type: string;
  createdAt: Date | string;
  description: string;
  newTotalValue?: number | null;
  indexType?: string | null;
}

export interface ContractDocument {
  id: number;
  type: string;
  title: string;
  content: string;
  createdAt: Date | string;
}

export interface AuditLog {
  id: number;
  action: string;
  userName: string | null;
  createdAt: Date | string;
  details?: unknown;
}
