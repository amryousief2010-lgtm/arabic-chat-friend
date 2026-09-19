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
 * Wrap the Lovable MCP Vite plugin so requireVerifiedUser is applied in the
 * same tick as each emit. A sibling plugin is not enough: mcpPlugin writes
 * again on buildStart and can leave the generated serve() line unwrapped.
 */
export function withMcpAuthWrap(inner: Plugin): Plugin {
  const afterEmit = async (
    hook: ((this: unknown, ...args: unknown[]) => unknown) | undefined,
    ctx: unknown,
    args: unknown[],
  ) => {
    const result = await hook?.apply(ctx, args);
    applyMcpVerifiedUserWrap();
    return result;
  };

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "configResolved") {
        return async function configResolved(this: unknown, ...args: unknown[]) {
          return afterEmit(target.configResolved as never, this, args);
        };
      }
      if (prop === "buildStart") {
        return async function buildStart(this: unknown, ...args: unknown[]) {
          return afterEmit(target.buildStart as never, this, args);
        };
      }
      if (prop === "closeBundle") {
        return async function closeBundle(this: unknown, ...args: unknown[]) {
          return afterEmit(
            (target as Plugin & { closeBundle?: Plugin["closeBundle"] }).closeBundle as never,
            this,
            args,
          );
        };
      }
      if (prop === "configureServer") {
        return function configureServer(this: unknown, server: { watcher: { on: (ev: string, cb: (file: string) => void) => void } }) {
          const result = target.configureServer?.call(this, server as never);
          const targetPath = MCP_FUNCTION_ENTRY.replace(/\\/g, "/");
          server.watcher.on("change", (file) => {
            if (file.replace(/\\/g, "/") !== targetPath) return;
            queueMicrotask(() => {
              try {
                applyMcpVerifiedUserWrap();
              } catch {
                // emit may still be writing
              }
            });
          });
          return result;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}
