import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";

export const analyticsRouter = router({
  getOverview: protectedProcedure
    .query(async () => {
      const processesByStatus = await db.getProcessCountByStatus();
      const documentsByMonth = await db.getDocumentCountByMonth(6);
      const mostActiveMembers = await db.getMostActiveMembers(10);
      const allUsers = await db.getAllUsers();
      const totalProcesses = processesByStatus.reduce((sum, item) => sum + item.count, 0);
      return {
        totalUsers: allUsers.length,
        totalProcesses,
        processesByStatus,
        documentsByMonth,
        mostActiveMembers,
      };
    }),
});
