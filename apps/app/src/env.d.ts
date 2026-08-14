interface AppEnv {
  CORE: Fetcher;
  AGENTS: Fetcher;
  ACCESS_AUD: string;
  ENVIRONMENT: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
  }
}

export {};
