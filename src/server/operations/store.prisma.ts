import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ActivityEntry, NewOperation, OperationStatus, OperationStore } from "./runner";

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

const optionalJson = (value: unknown) => (value === undefined ? undefined : json(value));

/** PostgreSQL-backed operation and activity records. */
export const prismaOperationStore: OperationStore = {
  async createOperation(input: NewOperation) {
    const row = await prisma.tikTokOperation.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        advertiserId: input.advertiserId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        action: input.action,
        requestedData: json(input.requestedData),
      },
    });
    return row.id;
  },

  async markRunning(id: string) {
    await prisma.tikTokOperation.update({ where: { id }, data: { status: "RUNNING", startedAt: new Date() } });
  },

  async complete(id: string, status: OperationStatus, error?: string, technicalError?: string) {
    await prisma.tikTokOperation.update({
      where: { id },
      data: { status, error: error ?? null, technicalError: technicalError ?? null, completedAt: new Date() },
    });
  },

  async setResource(id: string, resourceId: string) {
    await prisma.tikTokOperation.update({ where: { id }, data: { resourceId } });
  },

  async logActivity(entry: ActivityEntry) {
    await prisma.activityLog.create({
      data: {
        workspaceId: entry.workspaceId,
        userId: entry.userId,
        userName: entry.userName,
        operationId: entry.operationId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        resourceName: entry.resourceName,
        advertiserId: entry.advertiserId,
        before: optionalJson(entry.before),
        after: optionalJson(entry.after),
        result: entry.result,
        message: entry.message,
      },
    });
  },
};
