import { AppError, isAppError } from "../lib/errors.ts";

const MAX_BODY_BYTES = 16 * 1024;

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function errorResponse(error: unknown): Response {
  if (isAppError(error)) {
    return json({ error: { code: error.code, message: error.message } }, error.status);
  }

  console.error("unhandled error", error);
  return json(
    { error: { code: "internal_error", message: "something went wrong" } },
    500,
  );
}

export async function readJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new AppError(415, "unsupported_media_type", "content-type must be application/json");
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    throw new AppError(413, "payload_too_large", `body must be at most ${MAX_BODY_BYTES} bytes`);
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new AppError(413, "payload_too_large", `body must be at most ${MAX_BODY_BYTES} bytes`);
  }
  if (text.trim().length === 0) {
    throw new AppError(400, "invalid_body", "request body is required");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AppError(400, "invalid_json", "request body must be valid JSON");
  }
}

/**
 * Best-effort client identity for rate limiting.
 *
 * X-Forwarded-For is trusted blindly here, which is only safe when the service
 * sits behind a proxy that overwrites the header. Exposed directly to the
 * internet, a client can spoof it and bypass the limiter.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}
