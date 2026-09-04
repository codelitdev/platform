"use client";

import { useEffect, useState, type ReactNode } from "react";

export function AuthGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let active = true;
    void fetch("/api/auth/get-session", {
      cache: "no-store",
      credentials: "include",
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const body = (await response.json()) as { user?: unknown };
        return Boolean(body.user);
      })
      .catch(() => false)
      .then((authenticated) => {
        if (!active) return;
        if (!authenticated) {
          window.location.replace("/login");
          return;
        }
        setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (checking) return <main>Checking session…</main>;
  return children;
}
