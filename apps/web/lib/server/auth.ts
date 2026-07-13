import crypto from "crypto";

export const SESSION_COOKIE_NAME = "helpdesk_session";

export const REMEMBER_ME_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days in seconds
export const STANDARD_MAX_AGE_SEC = 24 * 60 * 60; // 1 day in seconds

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days validation limit

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return secret;
}

export function validateCredentials(username: string, password: string): boolean {
  const expectedUsername = process.env.AUTH_USERNAME;
  const expectedPassword = process.env.AUTH_PASSWORD;
  if (!expectedUsername || !expectedPassword) return false;
  return username === expectedUsername && password === expectedPassword;
}

export function createSessionCookie(): string {
  const timestamp = Date.now().toString();
  const signature = crypto
    .createHmac("sha256", getAuthSecret())
    .update(timestamp)
    .digest("hex");
  return `${timestamp}.${signature}`;
}

export function validateSessionCookie(cookieValue: string): boolean {
  const parts = cookieValue.split(".");
  if (parts.length !== 2) return false;

  const [timestamp, signature] = parts;
  const ts = Number(timestamp);
  if (Number.isNaN(ts)) return false;

  // Check expiration (up to 30 days)
  if (Date.now() - ts > SESSION_MAX_AGE_MS) return false;

  // Verify signature
  const expected = crypto
    .createHmac("sha256", getAuthSecret())
    .update(timestamp)
    .digest("hex");

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function isRequestAuthenticated(request: Request): boolean {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookies = Object.fromEntries(
    cookieHeader
      .split(";")
      .filter(Boolean)
      .map((cookie) => {
        const [key, ...rest] = cookie.trim().split("=");
        return [key, rest.join("=")];
      })
  );

  const session = cookies[SESSION_COOKIE_NAME];
  if (!session) return false;

  try {
    return validateSessionCookie(session);
  } catch {
    return false;
  }
}
