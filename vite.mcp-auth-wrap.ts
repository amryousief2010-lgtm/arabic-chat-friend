import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

export const MCP_FUNCTION_ENTRY = path.resolve(
  process.cwd(),
  "supabase/functions/mcp/index.ts",
);

const GENERATED_SERVE_RE =
  /Deno\.serve\(\s*createSupabaseHandler\(\s*(\w+)\s*,\s*\{\s*functionName:\s*"mcp"\s*\}\s*\)\s*\)\s*;/;

function wrapFor(ident: string) {
  return `import {
  createServiceClient,
  isAuthResponse,
  requireVerifiedUser,
} from "../_shared/require-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const inner = createSupabaseHandler(${ident}, { functionName: "mcp" });

Deno.serve(async (req, info) => {
  if (req.method === "OPTIONS") return inner(req, info);
  const admin = createServiceClient();
  const verified = await requireVerifiedUser(req, corsHeaders, admin);
  if (isAuthResponse(verified)) return verified;
  return inner(req, info);
});`;
}

/** Re-apply JWT hardening after @lovable.dev/mcp-js regenerates the MCP function. */
export function applyMcpVerifiedUserWrap(filePath = MCP_FUNCTION_ENTRY): boolean {
  const raw = fs.readFileSync(filePath, "utf8");
  if (/\brequireVerifiedUser\b/.test(raw) && /\bisAuthResponse\b/.test(raw)) {
    return false;
  }
  const match = raw.match(GENERATED_SERVE_RE);
  if (!match) {
    throw new Error(
      "MCP generated Deno.serve(createSupabaseHandler(...)) line not found; cannot apply requireVerifiedUser wrap",
    );
  }
  fs.writeFileSync(filePath, raw.replace(GENERATED_SERVE_RE, wrapFor(match[1])), "utf8");
  return true;
}

/**
 * Runs after mcpPlugin emit (configResolved / buildStart) so Lovable Publish
 * can regenerate supabase/functions/mcp/index.ts while keeping requireVerifiedUser.
 * The AUTO-GENERATED banner stays, so the SDK does not throw on overwrite.
 */
export function mcpAuthWrapPlugin(): Plugin {
  return {
    name: "wrap-mcp-require-verified-user",
    configResolved() {
      applyMcpVerifiedUserWrap();
    },
    buildStart() {
      applyMcpVerifiedUserWrap();
    },
    configureServer(server) {
      const target = MCP_FUNCTION_ENTRY.replace(/\\/g, "/");
      const onChange = (file: string) => {
        if (file.replace(/\\/g, "/") !== target) return;
        queueMicrotask(() => {
          try {
            applyMcpVerifiedUserWrap();
          } catch {
            // mcpPlugin may still be writing the file
          }
        });
      };
      server.watcher.on("change", onChange);
    },
  };
}
