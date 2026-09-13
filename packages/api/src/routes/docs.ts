import { Hono } from 'hono';
import { config } from '../config';
import { ANS_VERSION } from '../lib/wellknown';
import { components, paths, tags } from '../openapi/spec';

/**
 * Serves the OpenAPI document assembled from src/openapi/spec.ts (which the
 * other route modules extend via registerPaths) and a Swagger UI page.
 */

const docsRouter = new Hono();

export function buildOpenApiSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title: 'ANS API',
      description: [
        'ANS: receipts and trust for agent work. Registration is free and proves key possession;',
        'trust comes only from countersigned receipts (trust-v1, GET /v1/trust/formula).',
        'Every 4xx is a teaching envelope {error, message, fix?, requestId} with a Link: rel="help" header;',
        'every public JSON response carries an `_ans` block. Authentication is signed requests,',
        'Bearer session tokens or Bearer api keys; a private key is never sent to the registry',
        '(a private-key header answers 400 private_key_in_header).',
      ].join(' '),
      version: ANS_VERSION,
      contact: { name: 'ANS', url: config.publicWebUrl },
      license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    externalDocs: { description: 'skill.md (agent-facing docs)', url: 'https://ans-registry.org/skill.md' },
    servers: [
      { url: config.publicApiUrl, description: 'Production' },
      { url: `http://localhost:${config.port}`, description: 'Local development' },
    ],
    tags: [...tags],
    paths: { ...paths },
    components: { securitySchemes: { ...components.securitySchemes }, schemas: { ...components.schemas } },
  };
}

// GET /docs/openapi.json
docsRouter.get('/openapi.json', (c) => {
  c.header('Cache-Control', 'public, max-age=300');
  return c.json(buildOpenApiSpec());
});

const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ANS API</title>
  <link rel="alternate" type="text/markdown" href="https://ans-registry.org/skill.md">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; padding: 0; background: #f6f4ee; }
    .topbar { display: none; }
    .swagger-ui .info { margin-bottom: 30px; }
    .swagger-ui .info .title { font-weight: 600; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function() {
      SwaggerUIBundle({
        url: '/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
        layout: "BaseLayout",
        defaultModelsExpandDepth: 1,
        docExpansion: "list",
      });
    };
  </script>
</body>
</html>`;

// GET /docs
docsRouter.get('/', (c) => new Response(swaggerHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

export { docsRouter };
