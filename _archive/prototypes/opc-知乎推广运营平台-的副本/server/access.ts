import { TRPCError } from "@trpc/server";
import { type UserRole } from "../drizzle/schema";
import { protectedProcedure } from "./_core/trpc";

export const permissions: Record<UserRole, string[]> = {
  boss: ["overview.read", "campaign.read", "campaign.write", "keyword.write", "callback.write", "analytics.read", "earnings.read", "role.manage"],
  leader: ["overview.read", "campaign.read", "campaign.write", "keyword.write", "callback.write", "analytics.read", "earnings.read"],
  member: ["overview.read", "campaign.read", "analytics.read", "earnings.read"],
};

export const roleProcedure = (roles: UserRole[]) => protectedProcedure.use(({ ctx, next }) => {
  const role = ctx.user.role as UserRole;
  if (!roles.includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "当前角色没有执行此操作的权限" });
  }
  return next({ ctx });
});

export const leaderProcedure = roleProcedure(["boss", "leader"]);
export const bossProcedure = roleProcedure(["boss"]);
