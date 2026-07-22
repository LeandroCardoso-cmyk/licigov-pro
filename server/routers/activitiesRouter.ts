import { tenantProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";

export const activitiesRouter = router({
  listByProcess: tenantProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Valida o processo pela organização antes de expor os logs.
      // Cross-tenant/inexistente retornam [] (não revelam existência).
      return await db.getActivityLogsByProcessForOrganization(input.processId, ctx.organizationId);
    }),
});
