type PosthogJs = {
  init(
    apiKey: string,
    options: {
      api_host?: string;
      defaults?: string;
      capture_exceptions?: boolean;
      loaded?: (instance: {
        register: (properties: Record<string, string>) => void;
      }) => void;
    },
  ): void;
  identify(id: string, properties?: Record<string, string>): void;
  group(type: string, key: string, properties?: Record<string, string>): void;
  reset(): void;
};

export type BrowserPerson = {
  id?: string;
  email?: string;
  name?: string | null;
};

export type CreateBrowserObservabilityOptions = {
  serviceName: string;
  environment: string;
  apiKey?: string | null;
  host?: string;
  /** Sends uncaught errors and unhandled rejections as `$exception`.
   * Defaults to `true`. */
  captureExceptions?: boolean;
};

export type BrowserObservability = {
  enabled: boolean;
  init(): Promise<void>;
  identify(user: BrowserPerson | null | undefined): void;
  /** Ties later events to a PostHog group, such as `group("school", id)`,
   * so they line up with server events sent with the same `groups`. */
  group(type: string, key: string | null | undefined, properties?: Record<string, string>): void;
  reset(): void;
};

const DEFAULT_HOST = "https://us.i.posthog.com";

let client: PosthogJs | null = null;
let initPromise: Promise<void> | null = null;
let activeKey: string | null = null;

/**
 * Optional browser PostHog (identify + session recording). Does not read
 * environment variables. Products pass `apiKey` from request-time env so
 * Next.js OSS images are not baked with `NEXT_PUBLIC_*`. Missing key is a
 * no-op and never loads `posthog-js`.
 */
export function createBrowserObservability(
  options: CreateBrowserObservabilityOptions,
): BrowserObservability {
  const apiKey = options.apiKey?.trim() || null;
  const enabled = Boolean(apiKey);

  return {
    enabled,
    init() {
      if (!apiKey) {
        return Promise.resolve();
      }
      if (client && activeKey === apiKey) {
        return Promise.resolve();
      }
      if (!initPromise) {
        initPromise = import("posthog-js")
          .then((mod) => {
            const posthog = (mod.default ?? mod) as unknown as PosthogJs;
            if (client && activeKey === apiKey) {
              return;
            }
            posthog.init(apiKey, {
              api_host: options.host?.trim() || DEFAULT_HOST,
              defaults: "2026-05-30",
              capture_exceptions: options.captureExceptions ?? true,
              loaded(instance) {
                instance.register({
                  service: options.serviceName,
                  environment: options.environment,
                });
              },
            });
            client = posthog;
            activeKey = apiKey;
          })
          .catch(() => {
            initPromise = null;
          });
      }
      return initPromise ?? Promise.resolve();
    },
    identify(user) {
      if (!client || !user?.id) {
        return;
      }
      client.identify(user.id, {
        ...(user.email ? { email: user.email } : {}),
        ...(user.name ? { name: user.name } : {}),
      });
    },
    group(type, key, properties) {
      const groupKey = key?.trim();
      if (!client || !type.trim() || !groupKey) {
        return;
      }
      client.group(type.trim(), groupKey, properties);
    },
    reset() {
      client?.reset();
    },
  };
}
