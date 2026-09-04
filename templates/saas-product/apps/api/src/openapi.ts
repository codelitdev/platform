import { generateOpenApi } from "@ts-rest/open-api";
import { contract } from "@__PRODUCT_SLUG__/api-contract";

export function createOpenApiDocument(publicApiUrl: string) {
    return generateOpenApi(
        contract,
        {
            info: {
                title: "__PRODUCT_NAME__ API",
                version: "1.0.0",
            },
            servers: [{ url: publicApiUrl }],
        },
    );
}
