import { Router, type Response } from "express";

export type HostedLoginMethod =
    | { type: "email-otp"; label?: string }
    | { type: "social"; providerId: string; label: string };

export interface CreateOAuthPagesRouterOptions {
    appName: string;
    authBasePath: string;
    allowedRedirectOrigins: readonly string[];
    defaultRedirectUrl: string;
    loginMethods: readonly HostedLoginMethod[];
    legacyHostOnlySessionCookieNames?: readonly string[];
    logoUrl?: string;
    faviconUrl?: string;
    primaryColor?: string;
}

type NormalizedOptions = Omit<
    CreateOAuthPagesRouterOptions,
    "authBasePath" | "allowedRedirectOrigins" | "defaultRedirectUrl"
> & {
    authBasePath: string;
    allowedRedirectOrigins: Set<string>;
    defaultRedirectUrl: string;
};

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function scriptLiteral(value: unknown): string {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

function frameProtection(response: Response) {
    response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Content-Type-Options", "nosniff");
}

function absoluteOrigin(value: string, field: string): string {
    let url: URL;
    try {
        url = new URL(value);
    } catch {
        throw new Error(`${field} must be an absolute URL`);
    }
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error(`${field} must use http or https`);
    }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error(`${field} must use https in production`);
    }
    if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
    ) {
        throw new Error(`${field} must contain origins without paths`);
    }
    return url.origin;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const OKLCH_COLOR = /^oklch\([0-9.%\s/,+-]+\)$/i;

function brandingColor(
    value: string | undefined,
    field: string,
): string | undefined {
    if (value === undefined) return undefined;
    const color = value.trim();
    if (HEX_COLOR.test(color) || OKLCH_COLOR.test(color)) return color;
    throw new Error(`${field} must be a hex or oklch() color`);
}

function brandingUrl(
    value: string | undefined,
    field: string,
): string | undefined {
    if (value === undefined) return undefined;
    const raw = value.trim();
    if (!raw) throw new Error(`${field} must be a URL`);
    if (raw.startsWith("/") && !raw.startsWith("//")) {
        if (/\s/.test(raw) || raw.includes("\\") || raw.includes("<")) {
            throw new Error(`${field} must be a safe URL`);
        }
        return raw;
    }
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new Error(`${field} must be an absolute URL`);
    }
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error(`${field} must use http or https`);
    }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
        throw new Error(`${field} must use https in production`);
    }
    if (url.username || url.password) {
        throw new Error(`${field} must not contain credentials`);
    }
    return url.toString();
}

function normalizeOptions(
    options: CreateOAuthPagesRouterOptions,
): NormalizedOptions {
    if (!options.appName.trim()) throw new Error("appName is required");
    if (
        !options.authBasePath.startsWith("/") ||
        options.authBasePath.startsWith("//")
    ) {
        throw new Error("authBasePath must be an absolute path");
    }
    const authBasePath =
        options.authBasePath === "/"
            ? ""
            : options.authBasePath.replace(/\/+$/, "");
    if (
        options.authBasePath.includes("?") ||
        options.authBasePath.includes("#") ||
        /\s/.test(options.authBasePath)
    ) {
        throw new Error("authBasePath must be an absolute path");
    }
    if (options.allowedRedirectOrigins.length === 0) {
        throw new Error("allowedRedirectOrigins must not be empty");
    }
    const allowedRedirectOrigins = new Set(
        options.allowedRedirectOrigins.map((origin) =>
            absoluteOrigin(origin, "allowedRedirectOrigins"),
        ),
    );
    let defaultRedirect: URL;
    try {
        defaultRedirect = new URL(options.defaultRedirectUrl);
    } catch {
        throw new Error("defaultRedirectUrl must be an absolute URL");
    }
    if (!allowedRedirectOrigins.has(defaultRedirect.origin)) {
        throw new Error("defaultRedirectUrl must use an allowed origin");
    }
    if (options.loginMethods.length === 0) {
        throw new Error("loginMethods must contain at least one method");
    }
    const methodIds = options.loginMethods.map((method) =>
        method.type === "email-otp"
            ? "email-otp"
            : `social:${method.providerId}`,
    );
    if (new Set(methodIds).size !== methodIds.length) {
        throw new Error("loginMethods must have unique method identifiers");
    }
    for (const method of options.loginMethods) {
        if (method.type === "social") {
            if (!method.providerId.trim() || !method.label.trim()) {
                throw new Error(
                    "social login methods require providerId and label",
                );
            }
        }
    }
    for (const name of options.legacyHostOnlySessionCookieNames ?? []) {
        if (!/^[A-Za-z0-9._-]+$/.test(name)) {
            throw new Error("legacy cookie names contain invalid characters");
        }
    }
    return {
        ...options,
        appName: options.appName.trim(),
        authBasePath,
        allowedRedirectOrigins,
        defaultRedirectUrl: defaultRedirect.toString(),
        logoUrl: brandingUrl(options.logoUrl, "logoUrl"),
        faviconUrl: brandingUrl(options.faviconUrl, "faviconUrl"),
        primaryColor: brandingColor(options.primaryColor, "primaryColor"),
    };
}

const STYLES = `
html{--brand-primary:#8c7a6b;color-scheme:light}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f4f4f5;color:#171717;font-family:system-ui,sans-serif}
.card{width:100%;max-width:400px;padding:32px;border:1px solid #e4e4e7;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.04)}.logo{width:38px;height:38px;margin:0 auto 20px;display:grid;place-items:center;border-radius:50%;background:#171717;color:#fff;font-weight:700}.logo.has-image{background:transparent;border-radius:8px}.logo img{width:38px;height:38px;object-fit:contain;display:block}
h1{margin:0 0 24px;text-align:center;font-size:22px;font-weight:650}.sub{margin:-12px 0 24px;text-align:center;color:#71717a;font-size:13px;line-height:1.5}.error{display:none;margin-bottom:16px;padding:10px 12px;border-radius:8px;background:#fef2f2;color:#b42318;font-size:13px}
form{margin:0}.field{margin-bottom:14px}label{display:block;margin-bottom:6px;font-size:12px;color:#52525b}input{width:100%;padding:11px 13px;border:1px solid #d4d4d8;border-radius:8px;background:#fff;color:#171717;font-size:15px}input:focus{outline:2px solid var(--brand-primary);outline-offset:1px;border-color:transparent}
button{width:100%;margin-top:8px;padding:11px;border:1px solid #d4d4d8;border-radius:8px;background:#fafafa;color:#171717;font-size:14px;font-weight:550;cursor:pointer}button:focus-visible{outline:2px solid var(--brand-primary);outline-offset:2px}.primary{border-color:var(--brand-primary);background:var(--brand-primary);color:#fff}.secondary{color:#52525b;background:transparent}.social{display:inline-flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1f1f1f;border-color:#dadce0;font-weight:500}.social:hover{background:#f7f8f8}.social svg{width:18px;height:18px;flex:0 0 18px}
.divider{display:flex;align-items:center;gap:10px;margin:18px 0;color:#a1a1aa;font-size:12px}.divider:before,.divider:after{content:"";flex:1;height:1px;background:#e4e4e7}
button:disabled{opacity:.55;cursor:not-allowed}.client{margin:20px 0;padding:14px;border:1px solid #e4e4e7;border-radius:9px;background:#fafafa}.client-name{font-weight:600;word-break:break-all}.scopes{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.scope{padding:4px 7px;border:1px solid #e4e4e7;border-radius:6px;color:#52525b;font-size:12px}.actions{display:flex;gap:8px}.actions button{margin:0}
`;

function page(title: string, body: string, options: NormalizedOptions): string {
    const favicon = options.faviconUrl
        ? `<link rel="icon" href="${escapeHtml(options.faviconUrl)}">`
        : "";
    const brandColor = options.primaryColor
        ? `html{--brand-primary:${options.primaryColor}}`
        : "";
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${favicon}<style>${STYLES}${brandColor}</style></head><body><main class="card">${body}</main></body></html>`;
}

function brandMark(options: NormalizedOptions): string {
    if (options.logoUrl) {
        return `<div class="logo has-image"><img src="${escapeHtml(options.logoUrl)}" alt="${escapeHtml(options.appName)}"></div>`;
    }
    return `<div class="logo">${escapeHtml(options.appName[0] ?? "?")}</div>`;
}

const SOCIAL_ICONS: Record<string, string> = {
    google: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>',
    github: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.7 7.7 0 0 1 8 4.84c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"/></svg>',
    microsoft:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 23 23" aria-hidden="true"><path fill="#f35325" d="M1 1h10v10H1z"/><path fill="#81bc06" d="M12 1h10v10H12z"/><path fill="#05a6f0" d="M1 12h10v10H1z"/><path fill="#ffba08" d="M12 12h10v10H12z"/></svg>',
};

function socialButton(
    method: Extract<HostedLoginMethod, { type: "social" }>,
): string {
    const icon = SOCIAL_ICONS[method.providerId] ?? "";
    return `<button type="button" class="social" data-provider="${escapeHtml(method.providerId)}">${icon}<span>${escapeHtml(method.label)}</span></button>`;
}

function clearLegacyCookies(
    response: Response,
    names: readonly string[] | undefined,
) {
    for (const name of names ?? []) {
        response.cookie(name, "", {
            path: "/",
            maxAge: 0,
            httpOnly: true,
            secure: true,
            sameSite: "lax",
        });
    }
}

function loginMarkup(options: NormalizedOptions): string {
    const emailMethod = options.loginMethods.find(
        (method) => method.type === "email-otp",
    );
    const socialMethods = options.loginMethods.filter(
        (method): method is Extract<HostedLoginMethod, { type: "social" }> =>
            method.type === "social",
    );
    const email = emailMethod
        ? `<form id="email-form"><div class="field"><label for="email">Email address</label><input id="email" type="email" required autocomplete="email"></div><button class="primary" type="submit">${escapeHtml(emailMethod.label ?? "Continue with email")}</button></form><form id="otp-form" hidden><div class="field"><label for="otp">Verification code</label><input id="otp" inputmode="numeric" required autocomplete="one-time-code"></div><button class="primary" type="submit">Sign in</button><button class="secondary" type="button" id="change-email">Use a different email</button></form>`
        : "";
    const social = socialMethods.map(socialButton).join("");
    const divider = email && social ? '<div class="divider">or</div>' : "";
    return `${brandMark(options)}<h1>Sign in to ${escapeHtml(options.appName)}</h1><div class="error" id="error" role="alert"></div>${email}${divider}${social}`;
}

function loginScript(
    options: NormalizedOptions,
    oauth: boolean,
    redirect?: string,
) {
    const authBasePath = scriptLiteral(options.authBasePath);
    const redirectTarget = scriptLiteral(redirect ?? "");
    return `<script>(function(){
var authBasePath=${authBasePath};var oauth=${oauth};var oauthQuery=location.search.slice(1);var redirectTarget=${redirectTarget};var errorEl=document.getElementById("error");
function showError(message){errorEl.textContent=message||"Sign-in failed. Please try again.";errorEl.style.display="block"}function clearError(){errorEl.style.display="none"}
async function post(path,body){var response=await fetch(authBasePath+path,{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(body)});var data={};try{data=await response.json()}catch{}if(!response.ok)throw new Error("Sign-in failed. Please try again.");return data}
function follow(data){var target=data.url||data.redirect_uri||redirectTarget;if(!target)throw new Error("Sign-in failed. Please try again.");location.assign(target)}
var emailForm=document.getElementById("email-form"),otpForm=document.getElementById("otp-form"),email="";
if(emailForm){emailForm.addEventListener("submit",async function(event){event.preventDefault();clearError();email=emailForm.querySelector("input").value;try{await post("/email-otp/send-verification-otp",{email:email,type:"sign-in",...(oauth?{oauth_query:oauthQuery}:{})});emailForm.hidden=true;otpForm.hidden=false}catch(error){showError(error.message)}});otpForm.addEventListener("submit",async function(event){event.preventDefault();clearError();try{var data=await post("/sign-in/email-otp",{email:email,otp:document.getElementById("otp").value,name:email.split("@")[0],...(oauth?{oauth_query:oauthQuery}:{})});follow(data)}catch(error){showError(error.message)}});document.getElementById("change-email").addEventListener("click",function(){otpForm.hidden=true;emailForm.hidden=false;clearError()})}
document.querySelectorAll("button.social").forEach(function(button){button.addEventListener("click",async function(){clearError();button.disabled=true;try{var body={provider:button.dataset.provider,...(oauth?{oauth_query:oauthQuery}:{callbackURL:redirectTarget,errorCallbackURL:location.href})};follow(await post("/sign-in/social",body))}catch(error){showError(error.message);button.disabled=false}})});
})();</script>`;
}

function allowedRedirect(
    requested: unknown,
    options: NormalizedOptions,
): string {
    if (typeof requested !== "string") return options.defaultRedirectUrl;
    try {
        const url = new URL(requested);
        return options.allowedRedirectOrigins.has(url.origin)
            ? url.toString()
            : options.defaultRedirectUrl;
    } catch {
        return options.defaultRedirectUrl;
    }
}

export function createOAuthPagesRouter(
    rawOptions: CreateOAuthPagesRouterOptions,
): Router {
    const options = normalizeOptions(rawOptions);
    const router = Router();

    router.get("/login", (request, response) => {
        frameProtection(response);
        clearLegacyCookies(response, options.legacyHostOnlySessionCookieNames);
        const redirect = allowedRedirect(request.query.redirect, options);
        response
            .type("html")
            .send(
                page(
                    `Sign in to ${options.appName}`,
                    loginMarkup(options) +
                        loginScript(options, false, redirect),
                    options,
                ),
            );
    });

    router.get("/oauth/login", (_request, response) => {
        frameProtection(response);
        clearLegacyCookies(response, options.legacyHostOnlySessionCookieNames);
        response
            .type("html")
            .send(
                page(
                    `Sign in to ${options.appName}`,
                    loginMarkup(options) + loginScript(options, true),
                    options,
                ),
            );
    });

    router.get("/oauth/consent", (request, response) => {
        frameProtection(response);
        const clientId =
            typeof request.query.client_id === "string"
                ? request.query.client_id
                : "OAuth client";
        const scope =
            typeof request.query.scope === "string" ? request.query.scope : "";
        const scopes = scope.split(/\s+/).filter(Boolean);
        const badges = scopes
            .map((item) => `<span class="scope">${escapeHtml(item)}</span>`)
            .join("");
        const body = `${brandMark(options)}<h1>Authorize ${escapeHtml(options.appName)} access</h1><p class="sub">Review the client and requested scopes.</p><div class="error" id="error"></div><div class="client"><div class="client-name">${escapeHtml(clientId)}</div>${badges ? `<div class="scopes">${badges}</div>` : ""}</div><div class="actions"><button class="primary" id="allow" type="button">Allow</button><button id="deny" type="button">Deny</button></div><script>(function(){var authBasePath=${scriptLiteral(options.authBasePath)},oauthQuery=location.search.slice(1),errorEl=document.getElementById("error"),buttons=[document.getElementById("allow"),document.getElementById("deny")];async function decide(accept){buttons.forEach(function(button){button.disabled=true});errorEl.style.display="none";try{var response=await fetch(authBasePath+"/oauth2/consent",{method:"POST",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify({accept:accept,oauth_query:oauthQuery})});var data={};try{data=await response.json()}catch{}var target=data.url||data.redirect_uri;if(!response.ok||!target)throw new Error();location.assign(target)}catch{errorEl.textContent="Could not complete authorization.";errorEl.style.display="block";buttons.forEach(function(button){button.disabled=false})}}buttons[0].addEventListener("click",function(){decide(true)});buttons[1].addEventListener("click",function(){decide(false)})})();</script>`;
        response
            .type("html")
            .send(page(`Authorize ${options.appName} access`, body, options));
    });

    return router;
}
