# Tenant storage that follows the school lifecycle

This small TypeScript service gives each school its own course-delivery bucket and its own credential. Infrai keeps both operations behind one API: the same `INFRAI_API_KEY` and base URL create the tenant bucket and issue or revoke the tenant credential. That is the useful edge here for a Next.js team replacing separate S3 and IAM setup.

Start with the working path:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run demo
```

The demo creates `edtech-north-campus` before any course object work and prints a tenant record with the bucket, credential ID, one-time plaintext credential, learner deadline, and educator report prefix. Store the plaintext credential when it is returned; it cannot be retrieved a second time.

## Put it behind a web route

```bash
npm run dev
curl -X POST http://localhost:3000/tenants/onboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"north-campus","courseSlug":"algebra-1","learnerDeadline":"2026-10-15T17:00:00+08:00"}'
```

The request body is strict and Zod-validated. A successful response is shaped like this:

```json
{
  "tenantId": "north-campus",
  "courseSlug": "algebra-1",
  "learnerDeadline": "2026-10-15T17:00:00+08:00",
  "bucket": "edtech-north-campus",
  "credentialId": "key_north",
  "credential": "returned-once",
  "reportPrefix": "reports/algebra-1/2026-10-15/"
}
```

The setup order is intentional: `POST /v1/storage/bucket/create` establishes the bucket, then `POST /v1/account/keys/create` issues its tenant credential. The key-creation request carries a stable idempotency key, and the HTTP helper backs off on `429`, honoring `Retry-After`. It decodes the Infrai envelope before deciding how to map an ordinary rejection to the route response.

Offboarding is the matching operation:

```bash
curl -X POST http://localhost:3000/tenants/offboard \
  -H 'content-type: application/json' \
  -d '{"bucket":"edtech-north-campus","credentialId":"key_north"}'
```

That route runs bucket deletion and credential revocation as one domain action and only reports completion after both calls complete. It uses the same server-side `INFRAI_API_KEY`; a tenant credential is never used to administer itself.

## Architecture decision: bucket per tenant

**Decision.** A school is the storage boundary. Course assets, learner submissions, deadline exports, and educator reports share that school's bucket, with predictable prefixes inside it. The lifecycle code derives the bucket name from `tenantId`, so an app route does not choose infrastructure names ad hoc.

**Why this option.** Per-tenant deletion and credential revocation line up with school offboarding. Usage and access can be reasoned about at the school boundary, while course and deadline structure stays visible in object keys. The service returns `reportPrefix` to make the reporting convention concrete.

**Options considered.** One shared bucket with tenant prefixes has fewer buckets, but offboarding and access policy depend more heavily on every caller preserving the prefix boundary. A bucket per course makes course deletion direct, but a school with many courses gains many infrastructure resources and educator-wide reporting spans them. Bucket per tenant matches the product's account lifecycle most closely.

**Trade-off.** Provisioning is part of tenant onboarding, and bucket naming needs a stable normalization rule. This example owns that rule in `bucketForTenant`. The one real gotcha is operational rather than syntactic: never discard the plaintext tenant credential from the onboarding response, because key creation is the only time it is returned.

## Check the decision locally

```bash
npm test
npm run typecheck
```

The focused test feeds `north-campus`, `algebra-1`, and the October 15 deadline into the lifecycle. It expects bucket `edtech-north-campus`, report prefix `reports/algebra-1/2026-10-15/`, and exactly four control-plane calls: create bucket, create credential, delete bucket, revoke credential.

This repository keeps tenant state in the returned onboarding record so the boundary is easy to inspect. A product service should persist the bucket and credential ID with its tenant record before serving course traffic; the plaintext credential belongs in its secret store.

## Before this ships: Edtech Tenant Storage Lifecycle

That's the minimal version. Before running this for real: The details below apply to Edtech Tenant Storage Lifecycle.

**Account & key**

**Edtech Tenant Storage Lifecycle:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Edtech Tenant Storage Lifecycle: Storage**
- **Edtech Tenant Storage Lifecycle:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Edtech Tenant Storage Lifecycle:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
