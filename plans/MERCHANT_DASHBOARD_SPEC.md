# VeilPay Merchant Dashboard - End-to-End Build Specification

This document outlines the architecture, phases, and API integrations required to build the **VeilPay Merchant Dashboard**. This dashboard serves as the self-service portal for merchants to manage their privacy-preserving payment infrastructure, view analytics, and configure developer settings (like Webhooks and API Keys).

---

## 1. Architecture & Tech Stack Recommendations

We recommend a modern, fast, and secure stack that aligns with the rest of the VeilPay ecosystem:

- **Framework**: [Next.js](https://nextjs.org/) (App Router recommended for server components and SEO).
- **Styling**: Tailwind CSS with custom utility components built from scratch to achieve the exact "sovereign minimalist" aesthetic. Avoid heavy component libraries.
- **State Management & Data Fetching**: [TanStack Query (React Query)](https://tanstack.com/query/latest) for caching, pagination, and invalidation of API responses.
- **Form Handling**: `react-hook-form` + `zod` for robust client-side validation.
- **Authentication Strategy**: The backend utilizes a stateless HMAC Signature + API Key mechanism, but is now equipped with **distributed Redis sessions**. The Next.js frontend should manage the login state by exchanging credentials for a session cookie, securely acting as the middle-tier to sign requests to the VeilPay Core API.

---

## 2. API Integration Surface

The VeilPay core backend already supports all the necessary endpoints for the dashboard.

**Base URL**: `https://veilpay-backend.com/api/v1` (or local `http://localhost:3001/api/v1`)
**Auth Headers Required**: `x-api-key`, `x-signature`, `x-timestamp`

### Merchant & Analytics
- `POST /merchant/register` - Register a new merchant account.
- `GET /merchant/:id` - Fetch merchant profile and settings.
- `PUT /merchant/:id` - Update settings (business name, webhook URL, etc.).
- `GET /merchant/:id/stats` - Fetch aggregated analytics (total volume, successful payments, pending invoices).

### Invoices & Payments
- `GET /invoice` - List all invoices (supports pagination/filtering).
- `GET /invoice/:id` - Get specific invoice details.
- `POST /invoice/create` - Generate a new invoice (manual creation via dashboard).
- `POST /invoice/:id/cancel` - Cancel a pending invoice.
- `GET /payment` - List all processed payments (on-chain deposits matched to invoices).

### Developer & Webhooks (The DLQ)
- `GET /webhook/failed` - Fetch the Dead-Letter Queue (DLQ). Lists permanently failed webhook deliveries.
- `POST /webhook/:id/retry` - Re-queue a failed webhook delivery back into the BullMQ pipeline.
- `POST /merchant/keys/publish` - Generate/rotate API keys.

---

## 3. Phased Implementation Plan

### Phase 1: Foundation & Authentication (Weeks 1-2)
**Goal:** Setup the repository, UI shell, and secure authentication flow.
- Initialize the Next.js project with Tailwind.
- Build the **Login & Registration** pages following sovereign minimalist principles.
- Implement the Next.js API route that securely signs requests (HMAC SHA-256) using the merchant's API key before forwarding them to the Core API.
- Establish the Redis-backed session cookie flow so the merchant doesn't have to constantly input their raw API key.
- Build the primary App Shell (Sidebar navigation, Header, responsive mobile menu).

### Phase 2: Core Dashboard & Analytics (Week 3)
**Goal:** Give the merchant a bird's-eye view of their business.
- Build the **Overview Dashboard**.
- Integrate `GET /merchant/:id/stats` to display:
  - Total Volume (USD equivalent).
  - 30-Day Activity Chart (bar/line chart using Recharts).
  - Quick summary cards: Pending Invoices, Completed Payments, Failed Webhooks.
- Build the **Settings Page** (business profile, tier display).

### Phase 3: Invoice & Payment Management (Weeks 4-5)
**Goal:** Full CRUD capabilities for transactions.
- Build the **Invoices Table** (`GET /invoice`). Include filters for Status (Pending, Paid, Expired, Cancelled).
- Build the **Invoice Detail View**. Allow the merchant to manually cancel an invoice.
- Build a **Create Invoice** modal for manual OTC (Over-The-Counter) billing.
- Build the **Payments Table** (`GET /payment`) showing the exact on-chain TX hashes, chains (EVM/SVM), and privacy levels used.

### Phase 4: Developer Hub & DLQ Recovery (Week 6)
**Goal:** Expose infrastructure tools to the merchant's engineering team.
- Build the **API Keys Page**. Allow revealing/rotating the API key and viewing the `API_KEY_SALT`.
- Build the **Webhooks Configuration Page**.
- Build the **Dead-Letter Queue (DLQ) Manager** (`GET /webhook/failed`). 
  - Show a table of failed payloads, HTTP status codes, and error reasons.
  - Implement a **"Retry"** action (`POST /webhook/:id/retry`) allowing merchants to manually push a failed event back to their server once their downtime is resolved.

### Phase 5: Business Features Expansion (Future)
**Goal:** Integrate upcoming VeilPay protocol upgrades.
- **Fiat On-Ramps:** UI to configure Stripe/MoonPay integrations for invoices.
- **Recurring Payments:** UI to manage active crypto subscriptions (Superfluid EVM / Solana Token Streams).
- **KYC Tiers:** UI to upload verification documents to unlock higher payment limits.

---

## 4. Design & UX Guidelines

- **Aesthetic (Sovereign Minimalist):** The UI must strictly adhere to the "Sovereign Minimalist" philosophy. Avoid bloated component libraries (no shadcn, MUI, or Bootstrap). Use ultra-clean, custom Tailwind utilities.
- **Color Palette:** Stark contrasts. Deep, true blacks (`#000000`), sharp whites (`#FFFFFF`), and minimal use of color except for critical status indicators (e.g., success/failure of payments). Avoid unnecessary gradients or "glassmorphism".
- **Typography:** Prioritize legibility and stark geometric fonts. Information density should be high but uncluttered.
- **Micro-interactions:** Keep animations instant and snappy, rather than drawn-out or bouncy. Hover states should be precise and utilitarian.
- **Security First:** Sensitive data like API Keys and Webhook Secrets should be masked by default and require a deliberate click to reveal. 
- **Empty States:** Utilitarian empty states. "0 Invoices" rather than playful illustrations.

## Audit Refresh

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 69 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 48
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 69 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 48
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 88 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 64
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 62 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 38
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 69 | Code Quality 70 | UX Polish 80 | Performance 78 | Production-Readiness 44
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 69 | Code Quality 0 | UX Polish 80 | Performance 78 | Production-Readiness 0
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (security)
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-29

- **Refreshed:** 2026-05-29
- **Auditor:** automated
- **Plan_Score:** Security 93 | Code Quality 0 | UX Polish 80 | Performance 78 | Production-Readiness 0
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 94 | UX Polish 80 | Performance 78 | Production-Readiness 94
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 0 | UX Polish 80 | Performance 78 | Production-Readiness 0
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 51 | UX Polish 80 | Performance 78 | Production-Readiness 51
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (code_quality)
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
  - Score below pass threshold; see corresponding Audit_Report section. (production_readiness)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 94 | UX Polish 80 | Performance 78 | Production-Readiness 94
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 80 | Performance 78 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 80 | Performance 78 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 80 | Performance 78 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
  - Score below pass threshold; see corresponding Audit_Report section. (ux_polish)
  - Score below pass threshold; see corresponding Audit_Report section. (performance)
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 85 | Performance 85 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)

## Audit Refresh — 2026-05-31

- **Refreshed:** 2026-05-31
- **Auditor:** automated
- **Plan_Score:** Security 95 | Code Quality 95 | UX Polish 85 | Performance 85 | Production-Readiness 95
- **Disposition:** updated
- **Summary of Changes:**
  - Score reflects findings captured by the consolidated production-readiness audit.
- **Cross-Reference:** [PRODUCTION_READINESS_AUDIT.md](./PRODUCTION_READINESS_AUDIT.md)
