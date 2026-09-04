import type { Server } from "node:http";
import type { Express } from "express";

export async function withHttpServer<T>(
    app: Express,
    run: (baseUrl: string) => Promise<T>,
): Promise<T> {
    const server = await new Promise<Server>((resolve) => {
        const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    try {
        const address = server.address();
        if (!address || typeof address === "string") {
            throw new Error("test server did not expose a TCP address");
        }
        return await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
}
