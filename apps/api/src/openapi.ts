// Hand-maintained OpenAPI 3.0 description of the Awosanmo API. Served as raw JSON
// at /api/openapi.json and rendered with Swagger UI at /api/docs.

const bearer = [{ bearerAuth: [] }];

export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Awosanmo API",
    version: "1.0.0",
    description:
      "Self-hosted private cloud torrenting & streaming platform. All /api routes " +
      "require a Bearer access token except login, register, refresh and the " +
      "token-in-query media routes. Accounts are fully siloed per user.",
  },
  servers: [{ url: "/", description: "This server" }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
    schemas: {
      Session: {
        type: "object",
        properties: { token: { type: "string" }, refreshToken: { type: "string" } },
      },
      TwoFactorChallenge: {
        type: "object",
        properties: { twoFactorRequired: { type: "boolean" }, ticket: { type: "string" } },
      },
      Credentials: {
        type: "object",
        required: ["email", "password"],
        properties: { email: { type: "string", format: "email" }, password: { type: "string", minLength: 8 } },
      },
      Torrent: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" }, status: { type: "string" },
          progress: { type: "number" }, download_speed: { type: "integer" }, upload_speed: { type: "integer" },
          size: { type: "integer" }, info_hash: { type: "string", nullable: true },
        },
      },
      FileRow: {
        type: "object",
        properties: {
          id: { type: "string" }, name: { type: "string" }, path: { type: "string" },
          size: { type: "integer" }, media_kind: { type: "string" }, streamable: { type: "integer" },
          folder_id: { type: "string", nullable: true },
        },
      },
      Folder: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, parent_id: { type: "string", nullable: true } },
      },
      WishlistItem: {
        type: "object",
        properties: { id: { type: "string" }, name: { type: "string" }, magnet_uri: { type: "string" }, size: { type: "integer" } },
      },
      Error: { type: "object", properties: { error: { type: "string" } } },
    },
  },
  security: bearer,
  paths: {
    "/api/register": {
      post: {
        tags: ["Auth"], summary: "Create an account (open sign-up)", security: [],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Credentials" } } } },
        responses: { "201": { description: "Session", content: { "application/json": { schema: { $ref: "#/components/schemas/Session" } } } }, "409": { description: "Email taken" } },
      },
    },
    "/api/login": {
      post: {
        tags: ["Auth"], summary: "Log in (may require a 2FA second step)", security: [],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Credentials" } } } },
        responses: {
          "200": { description: "Session or 2FA challenge", content: { "application/json": { schema: { oneOf: [{ $ref: "#/components/schemas/Session" }, { $ref: "#/components/schemas/TwoFactorChallenge" }] } } } },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/api/login/2fa": {
      post: {
        tags: ["Auth"], summary: "Complete a 2FA login", security: [],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["ticket", "code"], properties: { ticket: { type: "string" }, code: { type: "string" } } } } } },
        responses: { "200": { description: "Session", content: { "application/json": { schema: { $ref: "#/components/schemas/Session" } } } }, "401": { description: "Invalid or expired code" } },
      },
    },
    "/api/refresh": {
      post: {
        tags: ["Auth"], summary: "Rotate tokens", security: [],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["refreshToken"], properties: { refreshToken: { type: "string" } } } } } },
        responses: { "200": { description: "New session", content: { "application/json": { schema: { $ref: "#/components/schemas/Session" } } } }, "401": { description: "Invalid" } },
      },
    },
    "/api/logout": { post: { tags: ["Auth"], summary: "Revoke a refresh token", security: [], responses: { "204": { description: "Done" } } } },
    "/api/2fa/status": { get: { tags: ["2FA"], summary: "Is 2FA enabled?", responses: { "200": { description: "Status" } } } },
    "/api/2fa/setup": { post: { tags: ["2FA"], summary: "Begin enrollment (returns QR + secret)", responses: { "200": { description: "Setup payload" } } } },
    "/api/2fa/enable": { post: { tags: ["2FA"], summary: "Confirm enrollment with a code", responses: { "200": { description: "Enabled" }, "400": { description: "Invalid code" } } } },
    "/api/2fa/disable": { post: { tags: ["2FA"], summary: "Disable 2FA (requires a code)", responses: { "200": { description: "Disabled" }, "400": { description: "Invalid code" } } } },
    "/api/torrents": {
      get: { tags: ["Torrents"], summary: "List your torrents", responses: { "200": { description: "Torrents", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Torrent" } } } } } } },
      post: {
        tags: ["Torrents"], summary: "Add a magnet",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["magnetUri"], properties: { magnetUri: { type: "string" } } } } } },
        responses: { "202": { description: "Accepted" } },
      },
    },
    "/api/torrents/upload": { post: { tags: ["Torrents"], summary: "Add a .torrent file (multipart 'torrent')", responses: { "202": { description: "Accepted" }, "400": { description: "No file" } } } },
    "/api/torrents/{id}": {
      get: { tags: ["Torrents"], summary: "Torrent detail", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Detail" }, "404": { description: "Not found" } } },
      delete: { tags: ["Torrents"], summary: "Remove a torrent", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "destroy", in: "query", schema: { type: "boolean" } }], responses: { "204": { description: "Removed" } } },
    },
    "/api/torrents/{id}/pause": { post: { tags: ["Torrents"], summary: "Pause", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "204": { description: "Paused" } } } },
    "/api/torrents/{id}/resume": { post: { tags: ["Torrents"], summary: "Resume", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "204": { description: "Resumed" } } } },
    "/api/uploads": { post: { tags: ["Files"], summary: "Upload any file (multipart 'file'), streamed to disk", responses: { "201": { description: "Stored" } } } },
    "/api/files": {
      get: {
        tags: ["Files"], summary: "List your files",
        parameters: [{ name: "q", in: "query", schema: { type: "string" } }, { name: "folderId", in: "query", schema: { type: "string" }, description: "'root', a folder id, or omit" }],
        responses: { "200": { description: "Files", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/FileRow" } } } } } },
      },
    },
    "/api/files/{id}": {
      patch: { tags: ["Files"], summary: "Rename a file", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" } } } } } }, responses: { "200": { description: "Renamed" } } },
      delete: { tags: ["Files"], summary: "Delete a file", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "204": { description: "Deleted" } } },
    },
    "/api/files/bulk-delete": { post: { tags: ["Files"], summary: "Delete many files", responses: { "200": { description: "{ deleted }" } } } },
    "/api/files/move": { post: { tags: ["Files"], summary: "Move files into a folder (or root)", responses: { "200": { description: "{ moved }" } } } },
    "/api/files/zip-token": { post: { tags: ["Files"], summary: "Get a token to download a zip of files", responses: { "200": { description: "{ zipToken }" } } } },
    "/api/zip": { get: { tags: ["Files"], summary: "Download a zip (token in query)", security: [], parameters: [{ name: "token", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "application/zip stream" }, "401": { description: "Invalid token" } } } },
    "/api/folders": {
      get: { tags: ["Folders"], summary: "List folders + breadcrumb", parameters: [{ name: "parent", in: "query", schema: { type: "string" } }, { name: "all", in: "query", schema: { type: "string" } }], responses: { "200": { description: "{ folders, breadcrumb }" } } },
      post: { tags: ["Folders"], summary: "Create a folder", responses: { "201": { description: "Folder", content: { "application/json": { schema: { $ref: "#/components/schemas/Folder" } } } } } },
    },
    "/api/folders/{id}": {
      patch: { tags: ["Folders"], summary: "Rename a folder", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Renamed" } } },
      delete: { tags: ["Folders"], summary: "Delete a folder", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "204": { description: "Deleted" } } },
    },
    "/api/wishlist": {
      get: { tags: ["Wishlist"], summary: "List saved magnets", responses: { "200": { description: "Items", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/WishlistItem" } } } } } } },
      post: { tags: ["Wishlist"], summary: "Save a magnet for later", responses: { "201": { description: "Saved" } } },
    },
    "/api/wishlist/{id}": { delete: { tags: ["Wishlist"], summary: "Remove a saved item", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "204": { description: "Removed" } } } },
    "/api/wishlist/{id}/download": { post: { tags: ["Wishlist"], summary: "Add a saved item to downloads", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "202": { description: "Accepted" } } } },
    "/api/stream-token/{id}": { post: { tags: ["Media"], summary: "Get a stream token for a file you own", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "{ streamToken }" }, "404": { description: "Not found" } } } },
    "/api/stream/{id}": { get: { tags: ["Media"], summary: "Range-stream a file (token in query 'st')", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "st", in: "query", schema: { type: "string" } }], responses: { "206": { description: "Partial content" }, "200": { description: "Full content" } } } },
    "/api/download/{id}": { get: { tags: ["Media"], summary: "Download a file (token in query 'dt')", security: [], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "dt", in: "query", schema: { type: "string" } }], responses: { "200": { description: "File stream" } } } },
    "/api/search": { get: { tags: ["Misc"], summary: "Search your torrents & files", parameters: [{ name: "q", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Results" } } } },
    "/api/stats": { get: { tags: ["Misc"], summary: "Process + torrent-count stats", responses: { "200": { description: "Stats" } } } },
    "/api/storage": { get: { tags: ["Misc"], summary: "Disk usage", responses: { "200": { description: "{ used, available, total }" } } } },
    "/api/admin/status": { get: { tags: ["Misc"], summary: "System + your content status", responses: { "200": { description: "Status" } } } },
    "/health": { get: { tags: ["Misc"], summary: "Health check", security: [], responses: { "200": { description: "{ ok: true }" } } } },
  },
} as const;
