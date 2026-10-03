"use client";

import { Button } from "@codelitdev/design-system";
import { type FormEvent, useEffect, useState } from "react";
import { AuthGate } from "../components/auth-gate";
import { TenantSwitcher } from "../components/tenant-switcher";

export default function HomePage() {
  const [tenants, setTenants] = useState<
    { id: string; name: string; selected?: boolean }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/v1/tenants", {
      credentials: "include",
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then((body: { items?: { id: string; name: string; selected?: boolean }[] }) =>
        setTenants(body.items ?? []),
      )
      .catch(() => setTenants([]));
  }, []);
  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch("/api/v1/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: form.get("name") }),
    });
    if (!response.ok) {
      setError("Unable to create the tenant.");
      return;
    }
    const tenant = (await response.json()) as {
      id: string;
      name: string;
      selected?: boolean;
    };
    setTenants((current) => [...current, tenant]);
    formElement.reset();
    window.location.reload();
  }
  return (
    <AuthGate>
      <main className="page-shell">
        <header className="app-header">
          <div>
            <p className="eyebrow">CodeLit Platform</p>
            <h1>__PRODUCT_SLUG__ workspace</h1>
            <p className="subtitle">Manage your teams and shared notes.</p>
          </div>
        </header>
        <section className="card stack" aria-labelledby="tenants-heading">
          <h2 id="tenants-heading">Tenants</h2>
          <TenantSwitcher tenants={tenants} />
          <form onSubmit={createTenant}>
            <label className="field">
              New tenant
              <input name="name" required maxLength={200} />
            </label>
            <Button type="submit">Create tenant</Button>
          </form>
          {error ? <p role="alert">{error}</p> : null}
        </section>
        <section className="card">
          <h2>Notes</h2>
          <p className="subtitle">Create and review notes for the selected tenant.</p>
          <p>
            <a href="/notes">Open notes →</a>
          </p>
        </section>
      </main>
    </AuthGate>
  );
}
