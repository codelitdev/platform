"use client";

import { Button } from "@codelitdev/design-system";
import Link from "next/link";
import { type FormEvent, useEffect, useState } from "react";
import { AuthGate } from "../../components/auth-gate";

type Note = { id: string; title: string; body: string };

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [workspace, setWorkspace] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/v1/tenants", { credentials: "include", cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { items: [] }))
      .then(
        async (body: {
          items?: { id: string; name: string; selected?: boolean }[];
        }) => {
          const selected = body.items?.find((tenant) => tenant.selected);
          setWorkspace(selected?.name ?? null);
          if (!selected) return { items: [] };
          const response = await fetch("/api/v1/notes", {
            credentials: "include",
            cache: "no-store",
            headers: { "x-tenant-id": selected.id },
          });
          return response.ok ? response.json() : { items: [] };
        },
      )
      .then((body: { items?: Note[] }) => setNotes(body.items ?? []))
      .catch(() => setNotes([]));
  }, []);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch("/api/v1/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        title: form.get("title"),
        body: form.get("body") ?? "",
      }),
    });
    if (response.ok) {
      const note = (await response.json()) as Note;
      setNotes((current) => [...current, note]);
      formElement.reset();
    }
  }
  return (
    <AuthGate>
      <main className="page-shell">
        <header className="app-header">
          <div>
            <p className="eyebrow">Workspace</p>
            <h1>Notes</h1>
            <p className="subtitle">Keep shared notes for your selected workspace.</p>
            <p className="eyebrow">Active workspace: {workspace ?? "None selected"}</p>
          </div>
          <Link href="/">Back to workspace</Link>
        </header>
        <section className="card stack">
          <ul className="note-list">
            {notes.map((note) => (
              <li className="note-item" key={note.id}>
                <strong>{note.title}</strong>
                <span className="muted">{note.body || "No details"}</span>
              </li>
            ))}
            {!notes.length ? <li className="muted">No notes yet.</li> : null}
          </ul>
        </section>
        <section className="card stack">
          <h2>Create a note</h2>
          <form onSubmit={create}>
            <label className="field">
              Title
              <input name="title" required />
            </label>
            <label className="field">
              Body
              <textarea name="body" />
            </label>
            <Button type="submit">Create note</Button>
          </form>
        </section>
      </main>
    </AuthGate>
  );
}
