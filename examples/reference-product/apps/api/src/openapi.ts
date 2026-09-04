import { generateOpenApi } from "@ts-rest/open-api";
import { contract } from "@reference-product/api-contract";

export function createOpenApiDocument(publicApiUrl: string) {
    return generateOpenApi(
        contract,
        {
            info: {
                title: "Reference Product API",
                version: "1.0.0",
            },
            servers: [{ url: publicApiUrl }],
        },
    );
}
