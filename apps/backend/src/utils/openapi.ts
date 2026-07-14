export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "VeilPay API",
    description: "Multi-Chain Privacy Payment Protocol API",
    version: "1.0.0",
    contact: {
      name: "VeilPay Support",
      email: "support@veilpay.com",
    },
  },
  servers: [
    {
      url: "http://localhost:3001",
      description: "Development server",
    },
    {
      url: "https://api.veilpay.com",
      description: "Production server",
    },
  ],
  security: [
    {
      ApiKeyAuth: [],
    },
  ],
  paths: {
    "/api/v1/health": {
      get: {
        summary: "Health check",
        description: "Returns the API health status",
        tags: ["Health"],
        responses: {
          "200": {
            description: "API is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    timestamp: { type: "string", format: "date-time" },
                    version: { type: "string", example: "1.0.0" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/merchant/register": {
      post: {
        summary: "Register a new merchant",
        description: "Creates a new merchant account and returns API credentials",
        tags: ["Merchant"],
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["businessName", "email"],
                properties: {
                  businessName: {
                    type: "string",
                    minLength: 1,
                    maxLength: 100,
                    example: "Acme Corp",
                  },
                  email: {
                    type: "string",
                    format: "email",
                    example: "billing@acme.com",
                  },
                  webhookUrl: {
                    type: "string",
                    format: "uri",
                    example: "https://acme.com/webhooks/veilpay",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Merchant registered successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    merchantId: { type: "string", format: "uuid" },
                    businessName: { type: "string" },
                    email: { type: "string" },
                    apiKey: { type: "string", example: "vp_abc123..." },
                    status: { type: "string", enum: ["active", "pending", "suspended"] },
                  },
                },
              },
            },
          },
          "409": {
            description: "Email already registered",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/v1/invoice/create": {
      post: {
        summary: "Create a new invoice",
        description: "Creates a payment invoice for the authenticated merchant with optional expiration",
        tags: ["Invoice"],
        security: [
          { ApiKeyAuth: [] },
          { Signature: [] },
          { Timestamp: [] },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["merchantId", "chainKey", "tokenSymbol", "amount"],
                properties: {
                  merchantId: { type: "string", format: "uuid" },
                  chainKey: { type: "string", example: "ethereum" },
                  tokenSymbol: { type: "string", example: "USDC" },
                  amount: { type: "string", example: "100.00" },
                  memo: { type: "string", example: "Order #12345" },
                  expiresInMinutes: { type: "integer", minimum: 1, maximum: 43200, default: 60 },
                  privacyLevel: { type: "string", enum: ["standard", "stealth", "max", "private"], default: "standard" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Invoice created successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    invoiceId: { type: "string", format: "uuid" },
                    merchantId: { type: "string", format: "uuid" },
                    status: { type: "string", enum: ["pending", "paid", "expired", "cancelled"] },
                    paymentAddress: { type: "string" },
                    paymentTxHash: { type: "string" },
                    paidAt: { type: "string", format: "date-time" },
                    expiresAt: { type: "string", format: "date-time" },
                    chainKey: { type: "string" },
                    tokenSymbol: { type: "string" },
                    amount: { type: "string" },
                    memo: { type: "string" },
                    privacyLevel: { type: "string", enum: ["standard", "stealth", "max", "private"] },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/invoice/{id}/status": {
      get: {
        summary: "Get invoice status",
        description: "Returns the current status of an invoice",
        tags: ["Invoice"],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Invoice status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    invoiceId: { type: "string", format: "uuid" },
                    status: { type: "string" },
                    paymentAddress: { type: "string" },
                    paymentTxHash: { type: "string" },
                    paidAt: { type: "string", format: "date-time" },
                    expiresAt: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "404": {
            description: "Invoice not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/api/v1/webhook/test": {
      post: {
        summary: "Test webhook endpoint",
        description: "Tests the webhook configuration for a merchant",
        tags: ["Webhook"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["merchantId"],
                properties: {
                  merchantId: { type: "string", format: "uuid" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Webhook test result",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    responseTime: { type: "integer", description: "Response time in ms" },
                    statusCode: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/webhook/verify": {
      post: {
        summary: "Verify webhook signature",
        description: "Verifies a webhook payload using the shared signing secret",
        tags: ["Webhook"],
        security: [
          { WebhookSignature: [] },
          { WebhookTimestamp: [] },
        ],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Webhook signature verified",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    verified: { type: "boolean" },
                    timestamp: { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
          "401": {
            description: "Invalid or missing signature",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "API key for authentication",
      },
      Signature: {
        type: "apiKey",
        in: "header",
        name: "x-signature",
        description: "HMAC signature over method, path, timestamp, and raw JSON body",
      },
      Timestamp: {
        type: "apiKey",
        in: "header",
        name: "x-timestamp",
        description: "Unix timestamp in milliseconds used to prevent replay attacks",
      },
      WebhookSignature: {
        type: "apiKey",
        in: "header",
        name: "x-veilpay-signature",
        description: "Webhook HMAC signature",
      },
      WebhookTimestamp: {
        type: "apiKey",
        in: "header",
        name: "x-veilpay-timestamp",
        description: "Unix timestamp in milliseconds for webhook verification",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string", example: "Validation error" },
          code: { type: "string", example: "VALIDATION_ERROR" },
          details: { type: "string" },
        },
      },
      Invoice: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          merchantId: { type: "string", format: "uuid" },
          chainKey: { type: "string" },
          tokenSymbol: { type: "string" },
          amount: { type: "string" },
          status: { type: "string", enum: ["pending", "paid", "expired", "cancelled"] },
          privacyLevel: { type: "string", enum: ["standard", "stealth", "max", "private"] },
          expiresAt: { type: "string", format: "date-time" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Merchant: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          businessName: { type: "string" },
          email: { type: "string", format: "email" },
          webhookUrl: { type: "string", format: "uri" },
          status: { type: "string", enum: ["active", "pending", "suspended", "deleted"] },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
  },
  tags: [
    { name: "Health", description: "Health check endpoints" },
    { name: "Merchant", description: "Merchant management endpoints" },
    { name: "Invoice", description: "Invoice management endpoints" },
    { name: "Webhook", description: "Webhook configuration endpoints" },
  ],
};
