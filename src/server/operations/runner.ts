import { describeFailure, technicalDetails } from "@/integrations/tiktok/tiktok.errors";

export type OperationStatus = "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "VERIFICATION_FAILED";

export interface OperationContext {
  workspaceId: string;
  userId: string;
  userName: string;
}

export interface NewOperation {
  workspaceId: string;
  userId: string;
  advertiserId: string;
  resourceType: string;
  resourceId?: string;
  action: string;
  requestedData: unknown;
}

export interface ActivityEntry {
  workspaceId: string;
  userId: string;
  userName: string;
  operationId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  advertiserId: string;
  before?: unknown;
  after?: unknown;
  result: "Success" | "Failed" | "Not verified";
  message?: string;
}

/** Persistence used by the runner. Production uses PostgreSQL; tests use an in-memory fake. */
export interface OperationStore {
  createOperation(input: NewOperation): Promise<string>;
  markRunning(id: string): Promise<void>;
  complete(id: string, status: OperationStatus, error?: string, technicalError?: string): Promise<void>;
  setResource(id: string, resourceId: string): Promise<void>;
  logActivity(entry: ActivityEntry): Promise<void>;
}

export interface Verification {
  ok: boolean;
  /** State read back from TikTok after the change. */
  after?: unknown;
  /** Shown to the user. Required when ok is false. */
  message?: string;
  resourceId?: string;
  resourceName?: string;
}

export interface OperationSpec<TExec> {
  /** Activity name, e.g. "Campaign Paused". */
  action: string;
  /** Used in error sentences, e.g. "Campaign pause". */
  failureLabel: string;
  resourceType: "campaign" | "adgroup" | "ad";
  resourceId?: string;
  resourceName?: string;
  advertiserId: string;
  requestedData: unknown;
  before?: unknown;
  /** Sends the change to TikTok. */
  execute(): Promise<TExec>;
  /** Re-reads the object from TikTok and compares it with what was requested. */
  verify(exec: TExec): Promise<Verification>;
  /** Extra context appended to a failure message, e.g. what was partly created. */
  failureNote?(): string | undefined;
}

export interface OperationResult {
  operationId: string;
  status: Exclude<OperationStatus, "QUEUED" | "RUNNING">;
  ok: boolean;
  message: string;
  after?: unknown;
  resourceId?: string;
}

/**
 * Runs one write against TikTok: record it, execute it, re-read the result from TikTok,
 * and only then report success. A call that returns without error is not treated as
 * success until the re-read state matches.
 */
export async function runOperation<TExec>(
  store: OperationStore,
  ctx: OperationContext,
  spec: OperationSpec<TExec>,
): Promise<OperationResult> {
  const operationId = await store.createOperation({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    advertiserId: spec.advertiserId,
    resourceType: spec.resourceType,
    resourceId: spec.resourceId,
    action: spec.action,
    requestedData: spec.requestedData,
  });
  await store.markRunning(operationId);

  const activity = (extra: Partial<ActivityEntry> & Pick<ActivityEntry, "result">): ActivityEntry => ({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    userName: ctx.userName,
    operationId,
    action: spec.action,
    resourceType: spec.resourceType,
    resourceId: spec.resourceId,
    resourceName: spec.resourceName,
    advertiserId: spec.advertiserId,
    before: spec.before,
    ...extra,
  });

  let exec: TExec;
  try {
    exec = await spec.execute();
  } catch (err) {
    const note = spec.failureNote?.();
    const message = [describeFailure(spec.failureLabel, err), note].filter(Boolean).join(" ");
    await store.complete(operationId, "FAILED", message, technicalDetails(err));
    await store.logActivity(activity({ result: "Failed", message }));
    return { operationId, status: "FAILED", ok: false, message };
  }

  let verification: Verification;
  try {
    verification = await spec.verify(exec);
  } catch (err) {
    const message = `TikTok accepted the request, but the result could not be confirmed. ${describeFailure("The follow-up check", err)} Refresh to see the current state.`;
    await store.complete(operationId, "VERIFICATION_FAILED", message, technicalDetails(err));
    await store.logActivity(activity({ result: "Not verified", message }));
    return { operationId, status: "VERIFICATION_FAILED", ok: false, message };
  }

  const resourceId = verification.resourceId ?? spec.resourceId;
  if (verification.resourceId) await store.setResource(operationId, verification.resourceId);
  const common = {
    resourceId,
    resourceName: verification.resourceName ?? spec.resourceName,
    after: verification.after,
  };

  if (!verification.ok) {
    const message = verification.message ?? "TikTok does not show the requested change.";
    await store.complete(operationId, "VERIFICATION_FAILED", message);
    await store.logActivity(activity({ ...common, result: "Not verified", message }));
    return { operationId, status: "VERIFICATION_FAILED", ok: false, message, after: verification.after, resourceId };
  }

  const message = verification.message ?? `${spec.action}.`;
  await store.complete(operationId, "SUCCEEDED");
  await store.logActivity(activity({ ...common, result: "Success", message }));
  return { operationId, status: "SUCCEEDED", ok: true, message, after: verification.after, resourceId };
}
