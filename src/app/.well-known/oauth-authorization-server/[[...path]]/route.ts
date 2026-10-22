import type { NextRequest } from "next/server";
import { json, preflight, serverMetadata } from "@/lib/mcp/http";

// RFC 8414, for MCP clients signing in to Looper.
export const GET = (request: NextRequest) => json(serverMetadata(request.nextUrl.origin));
export const OPTIONS = preflight;
