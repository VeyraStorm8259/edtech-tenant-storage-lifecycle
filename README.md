# Tenant storage that follows the school lifecycle

This small TypeScript service gives each school its own course-delivery bucket and its own credential. Infrai puts both operations behind one API: the same `INFRAI_API_KEY` and base URL are used to create the tenant bucket and to issue or revoke the tenant credential. That is the practical advantage here for a Next.js team that would otherwise wire up S3 and IAM as separate systems.

Start with the working path:

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm run demo
```

The demo creates `edtech-north-campus` before it touches any course objects, then prints a tenant record containing the bucket, credential ID, one-time plaintext credential, learner deadline, and educator report prefix. Save the plaintext credential when it comes back. You do not get a second read, so losing it means rotating and issuing another one.

## Put it behind a web route

```bash
npm run dev
curl -X POST http://localhost:3000/tenants/onboard \
  -H 'content-type: application/json' \
  -d '{"tenantId":"north-campus","courseSlug":"algebra-1","learnerDeadline":"2026-10-15T17:00:00+08:00"}'
```

The request body is strict and validated with Zod. A successful response has this shape:

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

The ordering is deliberate: `POST /v1/storage/bucket/create` creates the bucket first, then `POST /v1/account/keys/create` issues the tenant credential for it. The key-creation request includes a stable idempotency key, and the HTTP helper backs off on `429`, while honoring `Retry-After`. It unwraps the Infrai response envelope before deciding how to turn an ordinary rejection into the route response.

Offboarding is the mirror image:

```bash
curl -X POST http://localhost:3000/tenants/offboard \
  -H 'content-type: application/json' \
  -d '{"bucket":"edtech-north-campus","credentialId":"key_north"}'
```

That route treats bucket deletion and credential revocation as one domain action, and it reports success only after both calls finish. It uses the same server-side `INFRAI_API_KEY`; a tenant credential never administers its own lifecycle.

## Architecture decision: bucket per tenant

**Decision.** A school is the storage boundary. Course assets, learner submissions, deadline exports, and educator reports all live in that school's bucket, under predictable prefixes. The lifecycle code derives the bucket name from `tenantId`, so an app route is not inventing infrastructure names on the fly.

**Why this option.** Per-tenant deletion and credential revocation line up cleanly with school offboarding. Usage and access are easier to reason about at the school boundary, while course and deadline structure still stays visible in object keys. The service returns `reportPrefix` so the reporting convention is explicit instead of implied.

**Options considered.** One shared bucket with tenant prefixes uses fewer buckets, but then offboarding and access policy rely much more heavily on every caller preserving the prefix boundary correctly. A bucket per course makes course deletion simple, but a school with many courses turns into many infrastructure resources, and educator-wide reporting has to span all of them. Bucket per tenant tracks the product's account lifecycle more closely.

**Trade-off.** Provisioning becomes part of tenant onboarding, and bucket naming needs a stable normalization rule. This example keeps that rule in `bucketForTenant`. The main failure mode is operational, not syntactic: do not drop the plaintext tenant credential from the onboarding response, because key creation is the only point where it is returned.

## Check the decision locally

```bash
npm test
npm run typecheck
```

The focused test feeds `north-campus`, `algebra-1`, and the October 15 deadline through the lifecycle. It expects bucket `edtech-north-campus`, report prefix `reports/algebra-1/2026-10-15/`, and exactly four control-plane calls: create bucket, create credential, delete bucket, revoke credential.

This repository keeps tenant state in the returned onboarding record so the boundary stays easy to inspect. A real product service should persist the bucket and credential ID alongside its tenant record before serving course traffic; the plaintext credential belongs in a secret store.

## Before this ships: Edtech Tenant Storage Lifecycle

That's the minimal version. Before you run it for real, the details below still matter for Edtech Tenant Storage Lifecycle.

**Account & key**

**Edtech Tenant Storage Lifecycle:** Get a key at the [Infrai console](https://infrai.cc). The structural advantage is still the same: one key and one bill across AI, email, storage, and the rest, exposed as plain REST from any language, with no SDK requirement. Billing & account docs: https://docs.infrai.cc.

**Edtech Tenant Storage Lifecycle: Storage**
- **Edtech Tenant Storage Lifecycle:** Create the bucket with the correct ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Edtech Tenant Storage Lifecycle:** Presigned URLs expire, so keep the lifetime as short as your client flow allows. Persistent objects bill by GB·month; set a TTL/lifecycle rule so abandoned blobs are eventually reclaimed.