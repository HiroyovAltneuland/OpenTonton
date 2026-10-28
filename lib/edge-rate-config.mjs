// Approximate, per-Cloudflare-location admission control, before any D1 query.
// Namespaces are specific to this service; strict successful-create quotas stay in D1.
/** @type {Array<{name:string,namespace_id:string,simple:{limit:number,period:60}}>} */
export const RATE_LIMIT_BINDINGS = [
  { name:'API_READ_LIMIT', namespace_id:'17931901', simple:{limit:120,period:60} },
  { name:'API_WRITE_LIMIT', namespace_id:'17931902', simple:{limit:60,period:60} },
  { name:'CREATE_LIMIT', namespace_id:'17931903', simple:{limit:10,period:60} },
  { name:'GLOBAL_READ_LIMIT', namespace_id:'17931904', simple:{limit:1000,period:60} },
  { name:'GLOBAL_WRITE_LIMIT', namespace_id:'17931905', simple:{limit:200,period:60} },
];
