import type { Context, Handler } from "elysia";
import { timingSafeEqual } from "node:crypto";

export const DEVICE_TAGS = ["X4", "X3"] as const;
export type DeviceTag = (typeof DEVICE_TAGS)[number];

export type ParsedUser = { base: string; device: DeviceTag | null };

/**
 * Parse a basic-auth username of the form "<username>#<device>".
 *
 * The device tag is optional and case-insensitive. An unknown tag is
 * invalid, so a typo cannot silently select the wrong optimization
 * profile. CALIBRE_USERNAME must not itself contain "#".
 */
export function parseDeviceUsername(username: string): ParsedUser | null {
  const hash = username.lastIndexOf("#");
  if (hash === -1) return { base: username, device: null };
  const tag = username.slice(hash + 1).toUpperCase();
  if (!(DEVICE_TAGS as readonly string[]).includes(tag)) return null;
  return { base: username.slice(0, hash), device: tag as DeviceTag };
}

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
  if (!credentials) return null;

  let decoded: string;
  try {
    decoded = atob(credentials);
  } catch {
    return null;
  }

  const [username, password] = decoded.split(":");

  if (!username || !password) return null;

  return [username, password];
}

/**
 * Device tag carried by this request's basic-auth username, or null when
 * the request is untagged or has no usable credentials.
 */
export function deviceFromHeaders(
  headers: Context["headers"],
): DeviceTag | null {
  const auth = extractBasicAuth(headers);
  if (!auth) return null;
  return parseDeviceUsername(auth[0])?.device ?? null;
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

  // Reject unknown "#device" tags (e.g. "kien#x5") before comparing the
  // base username, so misspelled tags never fall back to plain auth.
  const parsed = parseDeviceUsername(auth[0]);

  const [isUsernameEqual, isPasswordEqual] = await Promise.all([
    safeCompare(parsed?.base ?? auth[0], expectedUsername),
    safeCompare(auth[1], expectedPassword),
  ]);

  if (!parsed || !(isUsernameEqual && isPasswordEqual)) {
    return new Response("Unauthorized", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Calibre"',
      },
    });
  }
};
