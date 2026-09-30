import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOperationRecord } from "../../domain/operationRecord";
import { createOperationalEvent } from "../../domain/operationalEvent";
import { insertOperationRecord, insertOperationalEvent } from "../../db/departmentOperation";
import { getDb } from "../../db/connection";

vi.mock("../../db/connection", () => ({ getDb: vi.fn() }));

describe("Centro de Operações — fronteira DATETIME(3)", () => {
  let inserted: Record<string, unknown> | undefined;
  let updated: Record<string, unknown> | undefined;

  beforeEach(() => {
    inserted = undefined;
    updated = undefined;
    vi.mocked(getDb).mockResolvedValue({
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserted = values;
          return {
            onDuplicateKeyUpdate: async ({ set }: { set: Record<string, unknown> }) => {
              updated = set;
            },
          };
        },
      }),
    } as never);
  });

  it("grava criação e atualização de registro no formato aceito pelo MySQL", async () => {
    const record = createOperationRecord({
      organizationId: 10, recordType: "processo_licitatorio_legado", number: "19/2026",
      correlationId: "corr-test", createdAt: "2026-09-28T19:55:24.859Z",
    });
    await insertOperationRecord(record);
    expect(inserted?.createdAt).toBe("2026-09-28 19:55:24.859");
    expect(inserted?.updatedAt).toBe("2026-09-28 19:55:24.859");
    expect(updated?.updatedAt).toBe("2026-09-28 19:55:24.859");
  });

  it("grava o certame mantendo data e horário locais como campos separados", async () => {
    const event = createOperationalEvent({
      organizationId: 10, eventType: "certame", title: "Certame", eventDate: "2026-10-13",
      eventTime: "09:30", referenceId: "oprec-1", correlationId: "corr-test",
      createdAt: "2026-09-28T19:55:24.859Z",
    });
    await insertOperationalEvent(event);
    expect(inserted?.createdAt).toBe("2026-09-28 19:55:24.859");
    expect(inserted?.eventDate).toBe("2026-10-13");
    expect(inserted?.eventTime).toBe("09:30");
  });
});
