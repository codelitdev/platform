"use client";

import { FormEvent, useState } from "react";
import { Button } from "@codelitdev/design-system";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/auth/email-otp/send-verification-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, type: "sign-in" }),
    });
    if (!response.ok) {
      setError("Unable to send a sign-in code.");
      return;
    }
    setSent(true);
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/auth/sign-in/email-otp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, otp, name: email.split("@")[0] }),
    });
    if (!response.ok) {
      setError("That code is invalid or expired.");
      return;
    }
    window.location.assign("/");
  }

  async function signInWithPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      setError("That email or password is invalid.");
      return;
    }
    window.location.assign("/");
  }

  return (
    <main className="auth-page">
      <section className="card auth-card stack">
        <p className="eyebrow">CodeLit Platform</p>
        <h1>Sign in</h1>
        <p className="subtitle">Access your reference workspace.</p>
        {!sent ? (
          <form onSubmit={sendCode}>
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <Button type="submit">Send sign-in code</Button>
          </form>
        ) : (
          <form onSubmit={verifyCode}>
            <p>Enter the code sent to {email}.</p>
            <label>
              Sign-in code
              <input
                inputMode="numeric"
                name="otp"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                required
              />
            </label>
            <Button type="submit">Sign in</Button>
          </form>
        )}
        {error ? <p role="alert">{error}</p> : null}
        <details>
          <summary>Local demo password sign-in</summary>
          <p>
            When started with SEED=1, use owner@example.com and
            reference-password-1.
          </p>
          <form onSubmit={signInWithPassword}>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            <Button type="submit">Sign in with password</Button>
          </form>
        </details>
        <small>
          Same-origin BFF cookies are set by the API after verification.
        </small>
      </section>
    </main>
  );
}
