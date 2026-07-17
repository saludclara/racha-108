import { NextResponse } from "next/server";
import {
  bodyTooLarge,
  clientIp,
  hasCronBearer,
  isSameOrigin,
  rateLimit,
} from "./rate-limit";

const MAX_BODY = 256 * 1024; // 256 KiB

export function guardJsonBody(req: Request): NextResponse | null {
  if (bodyTooLarge(req, MAX_BODY)) {
    return NextResponse.json({ error: "Payload demasiado grande" }, { status: 413 });
  }
  return null;
}

/**
 * Browser same-origin OR Bearer CRON_SECRET.
 * In development, allow missing Origin (curl / local scripts).
 */
export function guardBrowserOrCron(req: Request): NextResponse | null {
  if (hasCronBearer(req) || isSameOrigin(req)) return null;
  // Modern browsers set this on fetch; covers GET without Origin header
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "same-site" || site === "none") {
    return null;
  }
  if (process.env.NODE_ENV !== "production") return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export function guardRateLimit(
  req: Request,
  bucket: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const ip = clientIp(req);
  const { ok, retryAfterSec } = rateLimit(`${bucket}:${ip}`, limit, windowMs);
  if (ok) return null;
  return NextResponse.json(
    { error: "Too many requests" },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    },
  );
}
