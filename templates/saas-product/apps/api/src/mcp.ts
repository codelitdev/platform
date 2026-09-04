import { z } from "zod";
import {
    createMcpServerKit,
    type McpServerKit,
} from "@codelitdev/mcp-server-kit";
import {
    createNoteBodySchema,
    updateNoteBodySchema,
} from "@__PRODUCT_SLUG__/api-contract";
import {
    readOrCreateRequestId,
    type PlatformRequestContext,
} from "@codelitdev/platform";
import { authenticateMcpRequest } from "./auth/authenticate.js";
import {
    createNote,
    deleteNote,
    listNotes,
    updateNote,
} from "./notes.js";
import type { ReferencePermission } from "./permissions.js";
import { headerTenantId, resolveTenantContext } from "./tenancy.js";
import type { DispatchDeps } from "./deps.js";

type Ctx = PlatformRequestContext<string, string, ReferencePermission> & {
    publicTenantId: string;
};

export function createReferenceMcp(deps: DispatchDeps): McpServerKit<Ctx> {
    return createMcpServerKit<Ctx>({
        name: "__PRODUCT_SLUG__",
        version: "0.0.0",
        onError: ({ error, source }) =>
            deps.observability?.captureException({ error, source }),
        authenticate: (headers) => authenticateMcpRequest(headers, deps),
        async resolveContext({ principalId, credential, headers }) {
            const tenant = await resolveTenantContext({
                db: deps.db,
                principalId,
                credential: credential.credential,
                requestedPublicTenantId: headerTenantId(
                    headers as Record<string, string | string[] | undefined>,
                ),
            });
            if (!tenant.ok) return tenant;
            return {
                ok: true,
                context: {
                    requestId: readOrCreateRequestId(
                        typeof headers["x-request-id"] === "string"
                            ? headers["x-request-id"]
                            : undefined,
                        deps.clock,
                    ),
                    principalId,
                    tenantId: tenant.value.tenantId,
                    credential: credential.credential,
                    permissions: tenant.value.permissions,
                    publicTenantId: tenant.value.publicId,
                },
            };
        },
        tools: [
            {
                name: "notes.list",
                description: "List notes for the selected tenant",
                risk: "read",
                inputSchema: z.object({}),
                async handler({ context }) {
                    const result = await listNotes(
                        deps.db,
                        context,
                        context.publicTenantId,
                    );
                    if (!result.ok) return { error: result.error };
                    return { items: result.value };
                },
            },
            {
                name: "notes.create",
                description: "Create a note",
                risk: "write",
                inputSchema: createNoteBodySchema,
                async handler({ context, args }) {
                    const parsed = args as { title: string; body: string };
                    const result = await createNote(
                        deps.db,
                        context,
                        context.publicTenantId,
                        parsed,
                        deps.clock,
                    );
                    if (!result.ok) return { error: result.error };
                    return result.value;
                },
            },
            {
                name: "notes.update",
                description: "Update a note",
                risk: "write",
                inputSchema: updateNoteBodySchema.extend({
                    noteId: z.string(),
                }),
                async handler({ context, args }) {
                    const parsed = args as {
                        noteId: string;
                        title?: string;
                        body?: string;
                    };
                    const result = await updateNote(
                        deps.db,
                        context,
                        context.publicTenantId,
                        parsed.noteId,
                        parsed,
                        deps.clock,
                    );
                    if (!result.ok) return { error: result.error };
                    return result.value;
                },
            },
            {
                name: "notes.delete",
                description: "Delete a note",
                risk: "destructive",
                inputSchema: z.object({
                    noteId: z.string(),
                    confirm: z.boolean().optional(),
                }),
                async handler({ context, args }) {
                    const parsed = args as { noteId: string };
                    const result = await deleteNote(
                        deps.db,
                        context,
                        parsed.noteId,
                        deps.clock,
                    );
                    if (!result.ok) return { error: result.error };
                    return result.value;
                },
            },
        ],
    });
}
