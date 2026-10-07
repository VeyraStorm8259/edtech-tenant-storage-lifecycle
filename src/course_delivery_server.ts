import { createServer } from "node:http";
import { z } from "zod";
import { createInfraiClient, InfraiError } from "./infrai_client.js";
import { offboardTenant, onboardTenant } from "./tenant_lifecycle.js";

const onboardingBody = z.object({
  tenantId: z.string().min(2).regex(/^[a-z0-9-]+$/),
  courseSlug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  learnerDeadline: z.string().datetime({ offset: true }),
}).strict();

const offboardingBody = z.object({
  bucket: z.string().min(3),
  credentialId: z.string().min(1),
}).strict();

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const controlPlane = createInfraiClient();

export const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/tenants/onboard") {
      const input = onboardingBody.parse(await readJson(request));
      const tenant = await onboardTenant(controlPlane, input);
      send(response, 201, tenant);
      return;
    }
    if (request.method === "POST" && request.url === "/tenants/offboard") {
      const input = offboardingBody.parse(await readJson(request));
      send(response, 200, await offboardTenant(controlPlane, input));
      return;
    }
    send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { error: "Invalid request body", issues: error.issues });
    } else if (error instanceof InfraiError) {
      send(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        message: error.message,
      });
    } else {
      send(response, 500, { error: "Request could not be completed" });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Course delivery service listening on http://localhost:${port}`));
