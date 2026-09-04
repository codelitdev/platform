"use client";

import { Button } from "@codelitdev/design-system";
import { type FormEvent, useState } from "react";

type Tenant = { id: string; name: string; selected?: boolean };

export function TenantSwitcher({ tenants }: { tenants: Tenant[] }) {
  const [error, setError] = useState<string | null>(null);
  const selectedId = tenants.find((tenant) => tenant.selected)?.id ?? "";
  async function switchTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/tenant/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tenantId: form.get("tenantId") }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      setError(payload?.message ?? `Unable to switch tenant (${response.status}).`);
      return;
    }
    window.location.reload();
  }
  return (
    <form onSubmit={switchTenant}>
      <label className="field">
        Tenant
        <select
          key={selectedId}
          name="tenantId"
          aria-label="Tenant switcher"
          defaultValue={selectedId}
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit">Switch tenant</Button>
      {error ? <span role="alert">{error}</span> : null}
    </form>
  );
}
