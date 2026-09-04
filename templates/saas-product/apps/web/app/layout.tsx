import type { ReactNode } from "react";
import { headers } from "next/headers";
import "@codelitdev/design-system/styles.css";
import "./globals.css";
import { BrowserObservabilityProvider } from "../components/browser-observability";
import { getBrowserObservabilityConfig } from "../lib/observability-config";

export const metadata = {
  title: "Reference product",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  await headers();
  const posthog = getBrowserObservabilityConfig();

  return (
    <html lang="en">
      <body>
        {posthog ? (
          <BrowserObservabilityProvider
            apiKey={posthog.apiKey}
            host={posthog.host}
            environment={posthog.environment}
            serviceName={posthog.serviceName}
          >
            {children}
          </BrowserObservabilityProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
