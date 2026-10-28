import handler from "vinext/server/fetch-handler";
import { admitApiRequest, secureResponse, securityPolicy } from "../lib/edge-security";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";

const worker = {
  async scheduled(_controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    if (env.DB) ctx.waitUntil(import("../lib/server").then(({cleanup}) => cleanup(env.DB!)));
  },
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    const nonce=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    const policy=securityPolicy(nonce);
    const denied=await admitApiRequest(request,env);
    if(denied)return secureResponse(denied,policy);
    const headers=new Headers(request.headers);
    // Vinext reads the request CSP to nonce its own SSR/bootstrap scripts.
    // Overwrite caller-provided policy/nonce; never trust a client nonce.
    headers.set('Content-Security-Policy',policy);
    request=new Request(request,{headers});
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return secureResponse(await runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx)),policy);
  },
};

export default worker;
