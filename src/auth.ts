import type { Context, Handler } from "elysia";
import { timingSafeEqual } from "node:crypto";

/**
 * Extract Basic Auth to [username, password] pair
 * @param headers
 */
function extractBasicAuth(
  headers: Context["headers"],
): [string, string] | null {
  const authHeader = headers["authorization"];
  if (!authHeader) return null;
  const [type, credentials] = authHeader.split(" ");
  if (type !== "Basic") return null;

  if (!credentials) return null;

  const [username, password] = atob(credentials).split(":");

  if (!username || !password) return null;

  return [username, password];
}

async function safeCompare(a: string, b: string) {
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest("SHA-256", Buffer.from(a)),
    crypto.subtle.digest("SHA-256", Buffer.from(b)),
  ]);

  return timingSafeEqual(digestA, digestB);
}

export const requireAuth: Handler = async ({ headers }) => {
  const expectedUsername = process.env.CALIBRE_USERNAME;
  const expectedPassword = process.env.CALIBRE_PASSWORD;

  // If no expected username and password are present - skip
  if (!expectedUsername || !expectedPassword) {
    return;
  }

  const auth = extractBasicAuth(headers);

  if (!auth) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Calibre"',
      },
    });
  }

  const [isUsernameEqual, isPasswordEqual] = await Promise.all([
    safeCompare(auth[0], expectedUsername),
    safeCompare(auth[1], expectedPassword),
  ]);

  if (!auth || !(isUsernameEqual && isPasswordEqual)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Calibre"',
      },
    });
  }
};
