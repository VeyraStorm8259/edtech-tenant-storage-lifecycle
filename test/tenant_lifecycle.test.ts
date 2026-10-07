import assert from "node:assert/strict";
import test from "node:test";
import { createInfraiClient, type TenantControlPlane } from "../src/infrai_client.js";
import { offboardTenant, onboardTenant } from "../src/tenant_lifecycle.js";

test("a tenant owns one bucket and one credential across its lifecycle", async () => {
  const calls: string[] = [];
  const controlPlane: TenantControlPlane = {
    async createBucket(name) { calls.push(`bucket:create:${name}`); },
    async deleteBucket(name) { calls.push(`bucket:delete:${name}`); },
    async createTenantKey(tenantId) {
      calls.push(`key:create:${tenantId}`);
      return { id: "key_north", key: "plaintext-once" };
    },
    async revokeTenantKey(keyId) { calls.push(`key:revoke:${keyId}`); },
  };

  const tenant = await onboardTenant(controlPlane, {
    tenantId: "north-campus",
    courseSlug: "algebra-1",
    learnerDeadline: "2026-10-15T17:00:00+08:00",
  });
  assert.deepEqual(
    { bucket: tenant.bucket, reportPrefix: tenant.reportPrefix },
    { bucket: "edtech-north-campus", reportPrefix: "reports/algebra-1/2026-10-15/" },
  );

  const result = await offboardTenant(controlPlane, tenant);
  assert.deepEqual(result, { bucketDeleted: true, credentialRevoked: true });
  assert.deepEqual(calls, [
    "bucket:create:edtech-north-campus",
    "key:create:north-campus",
    "bucket:delete:edtech-north-campus",
    "key:revoke:key_north",
  ]);
});

test("the Infrai key response is mapped to the tenant key model", async () => {
  const client = createInfraiClient({
    apiKey: "test-key",
    fetcher: async () => new Response(JSON.stringify({
      ok: true,
      data: { key_id: "ifr_key_123", key_secret: "secret-once" },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  });

  assert.deepEqual(await client.createTenantKey("north-campus"), {
    id: "ifr_key_123",
    key: "secret-once",
  });
});
