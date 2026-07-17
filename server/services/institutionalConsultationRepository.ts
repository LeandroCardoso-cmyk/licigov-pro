/**
 * RC-5.1 (correção) — "Tirar Dúvidas" · Provider do repositório + adaptador in-memory (test/dev).
 *
 * A FONTE DE VERDADE em produção é o repositório MySQL (`mysqlConsultationRepository`). O adaptador
 * in-memory abaixo é um DOUBLE de teste (e fallback de dev SEM banco) — NUNCA a fonte oficial em
 * produção; simula o banco (persiste entre instâncias de service/repository) para viabilizar testes
 * de round-trip, restart lógico e isolamento multi-tenant. Injetável via setConsultationRepository.
 */

import { mysqlConsultationRepository } from "../db/institutionalConsultations";
import type { ConsultationRepository, ConsultationRecord, ConsultationSource, ListOpts } from "../domain/institutionalConsultation";

/**
 * Adaptador in-memory (test/dev). Mantém seu próprio "banco" (Maps) INTERNO ao objeto — cada
 * instância é um "banco" independente; instâncias de service/repository que compartilham este objeto
 * leem o mesmo estado (demonstra durabilidade sem depender de estado do service).
 */
export class InMemoryConsultationRepository implements ConsultationRepository {
  private readonly consultations = new Map<string, ConsultationRecord>();
  private readonly sources = new Map<string, ConsultationSource>();

  async createConsultation(rec: ConsultationRecord): Promise<ConsultationRecord> {
    this.consultations.set(rec.id, rec);
    return rec;
  }
  async markProcessing(tenantId: number, id: string, startedAt: string): Promise<void> {
    const r = this.consultations.get(id);
    if (r && r.tenantId === tenantId) this.consultations.set(id, { ...r, status: "processing", startedAt, updatedAt: startedAt });
  }
  async saveSources(sources: readonly ConsultationSource[]): Promise<void> {
    for (const s of sources) this.sources.set(s.id, s);
  }
  async completeConsultation(rec: ConsultationRecord, sources: readonly ConsultationSource[]): Promise<ConsultationRecord> {
    await this.saveSources(sources);            // fontes ANTES de concluir (sem estado falsamente completo)
    this.consultations.set(rec.id, rec);
    return rec;
  }
  async failConsultation(tenantId: number, id: string, errorCode: string, errorMessage: string, failedAt: string): Promise<void> {
    const r = this.consultations.get(id);
    if (r && r.tenantId === tenantId) this.consultations.set(id, { ...r, status: "failed", errorCode, errorMessage, failedAt, updatedAt: failedAt });
  }
  async findByIdForTenant(tenantId: number, id: string): Promise<ConsultationRecord | null> {
    const r = this.consultations.get(id);
    return r && r.tenantId === tenantId ? r : null;   // boundary: id de outro tenant → not found
  }
  async getSourcesForTenant(tenantId: number, consultationId: string): Promise<ConsultationSource[]> {
    return [...this.sources.values()].filter(s => s.tenantId === tenantId && s.consultationId === consultationId).sort((a, b) => a.sourceOrder - b.sourceOrder);
  }
  private page(list: ConsultationRecord[], opts: ListOpts): ConsultationRecord[] {
    const sorted = list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id.localeCompare(b.id)));
    const off = opts.offset ?? 0;
    return sorted.slice(off, off + (opts.limit ?? 50));
  }
  async listByTenant(tenantId: number, opts: ListOpts = {}): Promise<ConsultationRecord[]> {
    return this.page([...this.consultations.values()].filter(r => r.tenantId === tenantId), opts);
  }
  async listByUserForTenant(tenantId: number, userId: number, opts: ListOpts = {}): Promise<ConsultationRecord[]> {
    return this.page([...this.consultations.values()].filter(r => r.tenantId === tenantId && r.userId === userId), opts);
  }
  async findReplayCandidate(tenantId: number, contextReplayHash: string): Promise<ConsultationRecord | null> {
    const list = [...this.consultations.values()].filter(r => r.tenantId === tenantId && r.contextReplayHash === contextReplayHash && r.status === "completed")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return list[0] ?? null;
  }
  async verifyTenantOwnership(tenantId: number, id: string): Promise<boolean> {
    const r = this.consultations.get(id);
    return !!r && r.tenantId === tenantId;
  }
}

// ── Provider (produção = MySQL; injetável para testes) ────────────────────────
let _repository: ConsultationRepository = mysqlConsultationRepository;

export function getConsultationRepository(): ConsultationRepository { return _repository; }
export function setConsultationRepository(repo: ConsultationRepository): void { _repository = repo; }
export function resetConsultationRepository(): void { _repository = mysqlConsultationRepository; }
