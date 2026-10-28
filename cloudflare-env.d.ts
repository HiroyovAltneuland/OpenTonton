declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    API_READ_LIMIT?: RateLimit;
    API_WRITE_LIMIT?: RateLimit;
    CREATE_LIMIT?: RateLimit;
    GLOBAL_READ_LIMIT?: RateLimit;
    GLOBAL_WRITE_LIMIT?: RateLimit;
    BUCKET?: R2Bucket;
  }
}
