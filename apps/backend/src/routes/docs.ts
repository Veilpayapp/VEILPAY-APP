import { Router } from "express";
import { openApiSpec } from "../utils/openapi";
import { config } from "../config";

const router = Router();

router.get("/", (_req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.json(openApiSpec);
});

// BE-H5 fix: serve Swagger UI inline instead of loading from CDN
router.get("/ui", (_req, res) => {
  if (config.nodeEnv === "production") {
    res.status(403).json({ error: "API documentation is not available in production" });
    return;
  }

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>VeilPay API Documentation</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 16px; background: #0A0A0A; color: #e0e0e0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    h1 { color: #fff; }
    .endpoint { margin: 8px 0; padding: 12px; border: 1px solid #333; border-radius: 6px; background: #1a1a1a; }
    .method { font-weight: bold; color: #4CAF50; margin-right: 8px; font-family: monospace; }
    .path { font-family: monospace; color: #90CAF9; }
    .desc { color: #999; font-size: 0.9em; margin-top: 4px; }
  </style>
</head>
<body>
  <h1>VeilPay API Documentation</h1>
  <p>Base URL: <code>${config.nodeEnv === "development" ? "http://localhost:" + config.port : "https://api.veilpay.com"}</code></p>
  <div id="endpoints"></div>
  <script>
    const spec = ${JSON.stringify(openApiSpec)};
    const container = document.getElementById('endpoints');
    for (const [path, methods] of Object.entries(spec.paths || {})) {
      for (const [method, detail] of Object.entries(methods)) {
        const el = document.createElement('div');
        el.className = 'endpoint';
        el.innerHTML = '<span class="method">' + method.toUpperCase() + '</span><span class="path">' + path + '</span>' +
          (detail.description ? '<div class="desc">' + detail.description + '</div>' : '');
        container.appendChild(el);
      }
    }
  </script>
</body>
</html>`);
});

export { router as docsRoutes };
