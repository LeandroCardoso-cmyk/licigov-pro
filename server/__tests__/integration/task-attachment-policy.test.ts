/**
 * SEC-037 (PR B) — Testes do domínio puro da política de anexo de tarefa.
 * Cobre allowlist de MIME, validação por magic-bytes, limite de tamanho e
 * sanitização de nome com prevenção de path traversal.
 */
import { describe, it, expect } from "vitest";
import {
  ALLOWED_TASK_ATTACHMENT_MIME_TYPES,
  MAX_TASK_ATTACHMENT_BYTES,
  isAllowedTaskAttachmentMime,
  sanitizeAttachmentFileName,
  validateTaskAttachment,
} from "../../domain/taskAttachmentPolicy";

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const DOCX_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // "PK.."
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("SEC-037 · taskAttachmentPolicy", () => {
  describe("allowlist de MIME", () => {
    it("aceita apenas os tipos declarados", () => {
      expect(isAllowedTaskAttachmentMime("application/pdf")).toBe(true);
      expect(isAllowedTaskAttachmentMime("image/png")).toBe(true);
      expect(isAllowedTaskAttachmentMime(DOCX_MIME)).toBe(true);
      expect(isAllowedTaskAttachmentMime("application/x-msdownload")).toBe(false);
      expect(isAllowedTaskAttachmentMime("text/html")).toBe(false);
      expect(isAllowedTaskAttachmentMime("")).toBe(false);
    });

    it("expõe a allowlist como lista não vazia", () => {
      expect(ALLOWED_TASK_ATTACHMENT_MIME_TYPES.length).toBeGreaterThan(0);
      expect(ALLOWED_TASK_ATTACHMENT_MIME_TYPES).toContain("application/pdf");
    });
  });

  describe("validação de conteúdo (magic-bytes)", () => {
    it("aprova PDF real declarado como PDF", () => {
      expect(validateTaskAttachment(PDF, "application/pdf")).toMatchObject({ valid: true });
    });
    it("aprova PNG/JPEG/DOCX reais", () => {
      expect(validateTaskAttachment(PNG, "image/png").valid).toBe(true);
      expect(validateTaskAttachment(JPEG, "image/jpeg").valid).toBe(true);
      expect(validateTaskAttachment(DOCX_ZIP, DOCX_MIME).valid).toBe(true);
    });
    it("rejeita conteúdo que não corresponde ao MIME declarado", () => {
      const notPdf = Buffer.from("<html>isto não é um pdf</html>", "utf8");
      const res = validateTaskAttachment(notPdf, "application/pdf");
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/não corresponde/i);
    });
    it("rejeita MIME fora da allowlist", () => {
      const res = validateTaskAttachment(PDF, "application/x-msdownload");
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/não permitido/i);
    });
    it("rejeita arquivo vazio", () => {
      expect(validateTaskAttachment(Buffer.alloc(0), "application/pdf").valid).toBe(false);
    });
    it("rejeita arquivo acima do limite de tamanho", () => {
      const big = Buffer.alloc(MAX_TASK_ATTACHMENT_BYTES + 1);
      big[0] = 0x25; big[1] = 0x50; big[2] = 0x44; big[3] = 0x46; // %PDF
      const res = validateTaskAttachment(big, "application/pdf");
      expect(res.valid).toBe(false);
      expect(res.reason).toMatch(/limite/i);
    });
    it("text/plain: aceita texto e rejeita binário (byte NUL)", () => {
      expect(validateTaskAttachment(Buffer.from("relatório simples", "utf8"), "text/plain").valid).toBe(true);
      expect(validateTaskAttachment(Buffer.from([0x41, 0x00, 0x42]), "text/plain").valid).toBe(false);
    });
  });

  describe("sanitização de nome (path traversal)", () => {
    it("descarta componentes de caminho", () => {
      expect(sanitizeAttachmentFileName("../../etc/passwd")).not.toContain("/");
      expect(sanitizeAttachmentFileName("..\\..\\windows\\system32\\a.txt")).not.toContain("\\");
      expect(sanitizeAttachmentFileName("/abs/path/nota.pdf")).toBe("nota.pdf");
    });
    it("neutraliza sequências de ponto e caracteres inseguros", () => {
      expect(sanitizeAttachmentFileName("....pdf")).not.toContain("..");
      expect(sanitizeAttachmentFileName("arq;rm -rf.pdf")).toMatch(/^[a-zA-Z0-9_\-. ]+$/);
    });
    it("garante um fallback não vazio", () => {
      expect(sanitizeAttachmentFileName("")).toBe("arquivo");
      expect(sanitizeAttachmentFileName("///")).toBe("arquivo");
    });
    it("limita o comprimento", () => {
      expect(sanitizeAttachmentFileName("a".repeat(500)).length).toBeLessThanOrEqual(200);
    });
  });
});
