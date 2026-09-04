import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  register: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: {
    init: mocks.init,
    identify: mocks.identify,
    reset: mocks.reset,
  },
}));

const load = async () => {
  vi.resetModules();
  return import("./browser.js");
};

describe("createBrowserObservability", () => {
  beforeEach(() => {
    mocks.init.mockReset();
    mocks.identify.mockReset();
    mocks.reset.mockReset();
    mocks.register.mockReset();
    mocks.init.mockImplementation(
      (
        _key: string,
        options?: { loaded?: (client: { register: unknown }) => void },
      ) => {
        options?.loaded?.({ register: mocks.register });
      },
    );
  });

  it("does not read process.env and no-ops without an apiKey", async () => {
    const previous = process.env.POSTHOG_API_KEY;
    process.env.POSTHOG_API_KEY = "phc_should_not_be_read";
    const { createBrowserObservability } = await load();
    const obs = createBrowserObservability({
      serviceName: "demo-web",
      environment: "test",
    });
    expect(obs.enabled).toBe(false);
    await obs.init();
    obs.identify({ id: "user_1" });
    obs.reset();
    expect(mocks.init).not.toHaveBeenCalled();
    expect(mocks.identify).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
    process.env.POSTHOG_API_KEY = previous;
  });

  it("inits once, identifies a stable user id, and resets", async () => {
    const { createBrowserObservability } = await load();
    const obs = createBrowserObservability({
      serviceName: "demo-web",
      environment: "qa",
      apiKey: "phc_test",
      host: "https://eu.i.posthog.com",
    });
    expect(obs.enabled).toBe(true);
    await Promise.all([obs.init(), obs.init()]);
    expect(mocks.init).toHaveBeenCalledTimes(1);
    expect(mocks.init).toHaveBeenCalledWith("phc_test", {
      api_host: "https://eu.i.posthog.com",
      defaults: "2026-05-30",
      loaded: expect.any(Function),
    });
    expect(mocks.register).toHaveBeenCalledWith({
      service: "demo-web",
      environment: "qa",
    });
    obs.identify({ id: "user_1", email: "ada@example.com", name: "Ada" });
    expect(mocks.identify).toHaveBeenCalledWith("user_1", {
      email: "ada@example.com",
      name: "Ada",
    });
    obs.identify({ email: "nobody@example.com" });
    expect(mocks.identify).toHaveBeenCalledTimes(1);
    obs.reset();
    expect(mocks.reset).toHaveBeenCalledTimes(1);
  });
});
