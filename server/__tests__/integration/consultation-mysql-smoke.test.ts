/**
 * Smoke test contra MySQL REAL — regressão do INSERT de consulta (datas DATETIME).
 *
 * A suíte usa repositório in-memory; por isso o bug de formato de data (ISO "…T…Z" em coluna
 * DATETIME) escapou. Este teste exercita o REPOSITÓRIO MYSQL de verdade: só roda quando
 * `DATABASE_URL` está definido (CI com serviço MySQL efêmero) e é PULADO localmente/sem banco.
 *
 * Garante: a consulta é gravada e recuperada no MySQL sem erro de DATETIME, e as datas voltam como
 * ISO válido (round-trip da conversão de fronteira do banco).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import {
  answerConsultation, getConsultationForTenant, getConsultationSources,
  __setOfficialCorpusForTests, setInstitutionalProfileResolverForTests,
} from "../../services/institutionalConsultationService";
import { buildOfficialKnowledgeCorpus } from "../../services/officialCorpus/officialCorpusBuilder";
import { setConsultationRepository, resetConsultationRepository } from "../../services/institutionalConsultationRepository";
import { mysqlConsultationRepository } from "../../db/institutionalConsultations";

const DB = process.env.DATABASE_URL;

const DDL_CONSULTATIONS = `CREATE TABLE IF NOT EXISTS \`institutional_consultations\` (
  \`id\` VARCHAR(20) NOT NULL, \`organization_id\` INT NOT NULL, \`user_id\` INT NOT NULL,
  \`question\` TEXT, \`normalized_question\` TEXT, \`answer\` LONGTEXT,
  \`status\` VARCHAR(20) NOT NULL DEFAULT 'pending', \`limitation_reason\` VARCHAR(500) NOT NULL DEFAULT '',
  \`context_package_version\` VARCHAR(40) NOT NULL DEFAULT '', \`context_replay_hash\` VARCHAR(64) NOT NULL DEFAULT '',
  \`execution_id\` VARCHAR(40) NOT NULL DEFAULT '', \`answer_id\` VARCHAR(40) NOT NULL DEFAULT '',
  \`replay_id\` VARCHAR(40), \`replay_of_execution_id\` VARCHAR(40),
  \`correlation_id\` VARCHAR(64) NOT NULL DEFAULT '', \`business_domain\` VARCHAR(60) NOT NULL DEFAULT '',
  \`task_type\` VARCHAR(40) NOT NULL DEFAULT '', \`documents_count\` INT NOT NULL DEFAULT 0,
  \`passages_count\` INT NOT NULL DEFAULT 0, \`retrieval_duration_ms\` INT NOT NULL DEFAULT 0,
  \`execution_duration_ms\` INT NOT NULL DEFAULT 0, \`total_duration_ms\` INT NOT NULL DEFAULT 0,
  \`context_snapshot\` LONGTEXT, \`error_code\` VARCHAR(60) NOT NULL DEFAULT '', \`error_message\` VARCHAR(1000) NOT NULL DEFAULT '',
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), \`started_at\` DATETIME(3),
  \`completed_at\` DATETIME(3), \`failed_at\` DATETIME(3), \`updated_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`), INDEX \`idx_icons_org\` (\`organization_id\`),
  INDEX \`idx_icons_org_created\` (\`organization_id\`, \`created_at\`),
  INDEX \`idx_icons_org_user_created\` (\`organization_id\`, \`user_id\`, \`created_at\`),
  INDEX \`idx_icons_org_ctxhash\` (\`organization_id\`, \`context_replay_hash\`),
  INDEX \`idx_icons_corr\` (\`correlation_id\`), INDEX \`idx_icons_exec\` (\`execution_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

const DDL_SOURCES = `CREATE TABLE IF NOT EXISTS \`institutional_consultation_sources\` (
  \`id\` VARCHAR(32) NOT NULL, \`organization_id\` INT NOT NULL, \`consultation_id\` VARCHAR(20) NOT NULL,
  \`document_id\` VARCHAR(40) NOT NULL DEFAULT '', \`document_version\` VARCHAR(20) NOT NULL DEFAULT '',
  \`document_title\` VARCHAR(500) NOT NULL DEFAULT '', \`document_type\` VARCHAR(40) NOT NULL DEFAULT '',
  \`authority\` VARCHAR(160) NOT NULL DEFAULT '', \`jurisdiction\` VARCHAR(20) NOT NULL DEFAULT '',
  \`binding_level\` VARCHAR(40) NOT NULL DEFAULT '', \`citation\` VARCHAR(1000) NOT NULL DEFAULT '',
  \`passage\` TEXT, \`lineage\` VARCHAR(64) NOT NULL DEFAULT '', \`source_order\` INT NOT NULL DEFAULT 0,
  \`created_at\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`), INDEX \`idx_icsrc_org\` (\`organization_id\`),
  INDEX \`idx_icsrc_org_consultation\` (\`organization_id\`, \`consultation_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

describe.skipIf(!DB)("Smoke MySQL real — persistência de consulta (regressão do INSERT de DATETIME)", () => {
  beforeAll(async () => {
    const conn = await mysql.createConnection(DB!);
    await conn.query(DDL_CONSULTATIONS);
    await conn.query(DDL_SOURCES);
    await conn.end();
    __setOfficialCorpusForTests(buildOfficialKnowledgeCorpus({ correlationId: "mysql-smoke" }));
    setInstitutionalProfileResolverForTests(async () => ({ state: "PR", municipality: "Moreira Sales" }));
    setConsultationRepository(mysqlConsultationRepository);
  });
  afterAll(() => {
    resetConsultationRepository();
    setInstitutionalProfileResolverForTests(null);
    __setOfficialCorpusForTests(null);
  });

  it("grava e recupera a consulta no MySQL real, sem erro de DATETIME, com datas ISO válidas", async () => {
    const org = 900042;
    const correlationId = `mysql-smoke:${Date.now()}`;
    // O bug original lançava exatamente AQUI (INSERT do estado 'pending').
    const a = await answerConsultation({ organizationId: org, userId: 1, question: "Quando o ETP é obrigatório?", correlationId });
    expect(["completed", "limited"]).toContain(a.status);

    // Reload da FONTE DE VERDADE (MySQL).
    const rec = await getConsultationForTenant(org, a.executionId);
    expect(rec).not.toBeNull();
    expect(rec!.answerId).toBe(a.answerId);
    // Datas voltam como ISO válido (round-trip da conversão de fronteira).
    expect(rec!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(rec!.createdAt).toString()).not.toBe("Invalid Date");
    expect(rec!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    if (a.status === "completed") {
      const srcs = await getConsultationSources(org, a.executionId);
      expect(srcs.length).toBe(a.passages.length);
      expect(srcs[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });
});
