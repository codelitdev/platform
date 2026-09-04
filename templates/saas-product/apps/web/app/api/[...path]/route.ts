import { type NextRequest, NextResponse } from "next/server";

const API_URL = (process.env.API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const suffix = path.join("/");
  // The BFF strips its own `/api` segment.  Restore it for Better Auth and
  // account-scoped routes; versioned product APIs live at `/v1/*` upstream.
  const upstreamPath =
    path[0] === "auth" || path[0] === "tenant" ? `/api/${suffix}` : `/${suffix}`;
  const target = `${API_URL}${upstreamPath}${request.nextUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  let body: BodyInit | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      body = JSON.stringify(Object.fromEntries(form.entries()));
      headers.set("content-type", "application/json");
      headers.delete("content-length");
    } else {
      body = await request.text();
    }
  }
  const response = await fetch(target, {
    method: request.method,
    headers,
    body,
    redirect: "manual",
  });
  const outputHeaders = new Headers();
  for (const name of ["content-type", "set-cookie", "location", "x-request-id"]) {
    const value = response.headers.get(name);
    if (value) outputHeaders.set(name, value);
  }
  outputHeaders.set("cache-control", "no-store");
  return new NextResponse(response.body, {
    status: response.status,
    headers: outputHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
