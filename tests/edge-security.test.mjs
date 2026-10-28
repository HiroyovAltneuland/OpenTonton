import test from 'node:test';
import assert from 'node:assert/strict';
import {admitApiRequest,secureResponse,securityPolicy} from '../lib/edge-security.ts';
test('API admission fails closed when native limiter bindings are missing',async()=>{
 const request=new Request('https://example.test/api/events/'+'a'.repeat(32));
 const result=await admitApiRequest(request,{});assert.equal(result.status,503);assert.equal(result.headers.get('cache-control'),'no-store');
});
test('invalid routes and cross-origin writes stop before any limiter or DB',async()=>{
 const denied=await admitApiRequest(new Request('https://example.test/api/events',{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/json'},body:'{}'}),{});
 assert.equal(denied.status,403);
 assert.equal((await admitApiRequest(new Request('https://example.test/api/events/invalid'),{})).status,404);
});
test('security headers preserve response status and explicitly prohibit framing',()=>{
 const response=secureResponse(Response.json({error:'rejected'},{status:429}),securityPolicy('test-nonce'));
 assert.equal(response.status,429);assert.equal(response.headers.get('x-frame-options'),'DENY');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 assert(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
 assert(!response.headers.get('content-security-policy').includes("script-src 'unsafe-inline'"));
});
