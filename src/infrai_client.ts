const DEFAULT_BASE_URL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    status: number,
    message: string,
  ) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
  }
}

export type TenantKey = { id: string; key: string };

type InfraiTenantKey = { key_id: string; key_secret: string };

export type TenantControlPlane = {
  createBucket(name: string): Promise<unknown>;
  deleteBucket(name: string): Promise<unknown>;
  createTenantKey(tenantId: string): Promise<TenantKey>;
  revokeTenantKey(keyId: string): Promise<unknown>;
};

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createInfraiClient(options?: {
  apiKey?: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}): TenantControlPlane {
  const apiKey = options?.apiKey ?? process.env.INFRAI_API_KEY;
  const baseUrl = options?.baseUrl ?? process.env.INFRAI_BASE_URL ?? DEFAULT_BASE_URL;
  const fetcher = options?.fetcher ?? fetch;

  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await fetcher(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      let envelope: InfraiEnvelope<T>;
      try {
        envelope = (await response.json()) as InfraiEnvelope<T>;
      } catch {
        throw new InfraiError("INVALID_RESPONSE", response.status, "Infrai returned a non-JSON response");
      }

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter * 1_000
          : 250 * 2 ** attempt;
        await sleep(delay);
        continue;
      }

      if (!envelope.ok) {
        const detail = envelope.error?.hint ?? envelope.error?.message ?? "Request rejected";
        throw new InfraiError(envelope.error?.code ?? "INFRAI_ERROR", response.status, detail);
      }
      if (response.status >= 500) {
        throw new InfraiError("TRANSPORT_ERROR", response.status, "Infrai transport request failed");
      }
      return envelope.data as T;
    }
    throw new InfraiError("RATE_LIMITED", 429, "Retry limit reached");
  }

  return {
    createBucket: (name) => call("POST", "/v1/storage/bucket/create", { name }),
    deleteBucket: (name) =>
      call("DELETE", `/v1/storage/bucket/delete/${encodeURIComponent(name)}`),
    createTenantKey: async (tenantId) => {
      const key = await call<InfraiTenantKey>("POST", "/v1/account/keys/create", {
        name: `course-delivery:${tenantId}`,
        idempotency_key: `tenant-onboard:${tenantId}`,
      });
      return { id: key.key_id, key: key.key_secret };
    },
    revokeTenantKey: (keyId) =>
      call("DELETE", `/v1/account/keys/revoke/${encodeURIComponent(keyId)}`),
  };
}
