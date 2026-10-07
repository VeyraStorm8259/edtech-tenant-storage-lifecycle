import { createInfraiClient } from "./infrai_client.js";
import { onboardTenant } from "./tenant_lifecycle.js";

const tenant = await onboardTenant(createInfraiClient(), {
  tenantId: "north-campus",
  courseSlug: "algebra-1",
  learnerDeadline: "2026-10-15T17:00:00+08:00",
});

console.log(JSON.stringify(tenant, null, 2));
console.log("Store credential now; its plaintext value is only returned when the key is created.");
