import type { NextRequest } from "next/server";
import { json, preflight, resourceMetadata } from "@/lib/mcp/http";

// RFC 9728. Clients ask at the bare path or with the resource path appended (/mcp); both answer the same.
export const GET = (request: NextRequest) => json(resourceMetadata(request.nextUrl.origin));
export const OPTIONS = preflight;
