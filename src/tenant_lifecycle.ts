import type { TenantControlPlane } from "./infrai_client.js";

export type TenantPlan = {
  tenantId: string;
  courseSlug: string;
  learnerDeadline: string;
};

export type ActiveTenant = TenantPlan & {
  bucket: string;
  credentialId: string;
  credential: string;
  reportPrefix: string;
};

export function bucketForTenant(tenantId: string): string {
  return `edtech-${tenantId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

export async function onboardTenant(
  controlPlane: TenantControlPlane,
  plan: TenantPlan,
): Promise<ActiveTenant> {
  const bucket = bucketForTenant(plan.tenantId);
  await controlPlane.createBucket(bucket);
  const tenantKey = await controlPlane.createTenantKey(plan.tenantId);

  return {
    ...plan,
    bucket,
    credentialId: tenantKey.id,
    credential: tenantKey.key,
    reportPrefix: `reports/${plan.courseSlug}/${plan.learnerDeadline.slice(0, 10)}/`,
  };
}

export async function offboardTenant(
  controlPlane: TenantControlPlane,
  tenant: Pick<ActiveTenant, "bucket" | "credentialId">,
): Promise<{ bucketDeleted: true; credentialRevoked: true }> {
  await Promise.all([
    controlPlane.deleteBucket(tenant.bucket),
    controlPlane.revokeTenantKey(tenant.credentialId),
  ]);
  return { bucketDeleted: true, credentialRevoked: true };
}
