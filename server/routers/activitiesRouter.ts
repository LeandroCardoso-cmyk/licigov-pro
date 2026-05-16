import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import * as db from "../db";

export const activitiesRouter = router({
  listByProcess: protectedProcedure
    .input(z.object({ processId: z.number() }))
    .query(async ({ input }) => {
      return await db.getActivityLogsByProcess(input.processId);
    }),
});
