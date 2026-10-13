# NewLight — Project Guide

Turborepo monorepo (pnpm workspaces) for NewLight — an e-commerce platform with a public storefront and an internal admin dashboard.

## Structure

```
apps/
  www/     Next.js 16 storefront — public site, i18n (en/ar), cart, checkout, orders
  admin/   Next.js 16 admin dashboard — order/product management, no i18n
packages/
  database/           @repo/database — Prisma client + schema, shared by both apps
  mail/               @repo/mail — the only sender of email; templates + transactional outbox
  notifications/      @repo/notifications — the only writer of notifications; Web Push sweep
  typescript-config/   shared tsconfig base
```

There is no `packages/eslint-config` — it had no consumers and was deleted in P1 (see the
comment in `packages/database/eslint.config.mjs`). Each app carries its own local
`eslint.config.mjs` (`eslint-config-next` core-web-vitals + typescript); `packages/database`
has its own standalone flat config.

## Stack

- **Next.js 16** (App Router), **React 19**, **TypeScript**
- **Prisma 7** ORM against Postgres (Neon-hosted, via the `@prisma/adapter-pg` driver adapter —
  not the Neon serverless adapter), schema in [packages/database/prisma/schema.prisma](packages/database/prisma/schema.prisma)
- **Better Auth** for auth in both apps (`lib/auth.ts` is the one seam per app; migrated off
  Clerk in P2 — see `docs/adr/0004-auth-seam.md`)
- **Tailwind CSS 4**, shadcn-style UI components under `components/ui` in each app
- **next-intl** for i18n in `www` (locales: `en`, `ar` — RTL-aware; messages in `apps/www/messages/*.json`)
- **@tanstack/react-query** for client data fetching, **react-hook-form** + **zod** for forms/validation
- **framer-motion** / **gsap** for animation (`www` only — `admin` has neither)
- **pino** for logging (`lib/logger.ts` in each app)
- PWA support (`@ducanh2912/next-pwa` in www, service worker + manifest in both)

## Key domain models (Prisma)

Category/SubCategory (+ translations), Product/ProductTranslation, Cart/CartItem, Order/OrderItem, ShippingAddress, User, ContactForm(+Response/Tag), Notification, PushSubscription, SystemSetting, ProductConfiguration.

Translated content (Category, SubCategory, Product) uses a `*Translation` side-table pattern — check both the base model and its translation model when touching product/category data.

## Commands

Run from repo root (turbo fans out to affected packages):

```bash
pnpm dev              # all apps (www :3000, admin :3001)
pnpm build            # all apps
pnpm lint
pnpm check-types

# Tests need a PostgreSQL server they may create and drop databases on. Each test FILE gets
# its own disposable database with the real migration chain applied — not `db push`, which
# would test a schema no deployment produces.
TEST_DATABASE_URL=postgresql://$USER@localhost:5432/postgres pnpm test
```

Per-app (`cd apps/www` or `cd apps/admin`):

```bash
pnpm dev
pnpm build
pnpm lint
```

Database (`cd packages/database`):

```bash
pnpm db:generate      # prisma generate — run after schema changes
pnpm db:push          # push schema to DB (no migration file)
pnpm db:migrate       # prisma migrate dev
pnpm db:migrate:to X  # apply the chain up to migration X, in order. Used to replay history:
                      # 0011_drop_v1_catalog_columns is destructive and refuses to run before
                      # the v1->v2 transform (it counts rows) — the ordering that mattered during
                      # the P1/P2 cutover, already applied on the working branch, still enforced
                      # by the migration itself on any fresh database
pnpm db:status        # which migrations are applied
pnpm db:studio
pnpm verify           # prisma validate + format
SHADOW_DATABASE_URL=... pnpm db:verify-chain   # replaying migrations == schema.prisma
```

## Conventions

- Both apps import Prisma via `@repo/database` (workspace package) — don't instantiate `PrismaClient` directly in app code; use each app's `lib/db.ts`.
- Every database CLI command goes through `packages/database/scripts/with-env.mjs`, which loads `.env.local`/`.env.production` (Prisma's CLI only reads `.env`) and refuses to run anything write-capable against the production endpoint.
- `@repo/database` also owns the domain boundaries both apps must agree on: `money.ts` (never a `number`), `locale.ts`, `translation.ts` (never `take: 1` without a locale), `slug.ts` (the only Arabic slug generator), `inventory.ts` (the only writer of the stock ledger).
- `www` routes live under `app/[locale]/...` — any new storefront page must work under the locale segment and needs entries in both `messages/en.json` and `messages/ar.json` if it has visible strings.
- Route groups: `(main)` for storefront pages/sections, `(auth)` for sign-in/sign-up, mirrored in both apps.
- Server actions live in `apps/www/actions/*.ts` (cart, order, search, configuration) — prefer extending these over adding new API routes when the operation is app-internal.
- Notifications and push go through `@repo/notifications`: resolve recipients with `adminRecipients(prisma)` **before** the transaction, then `notifyRecipients(tx, recipients, …)` **inside** it — never a bare `prisma.notification.create` at a call site. The read is outside because it is a Seq Scan on `users` and, at SERIALIZABLE, locks the whole table. The one exception is `packages/database/inventory.ts`, which cannot import the package without closing a dependency cycle and writes rows directly; the sweep picks those up like any other. Delivery is a separate sweep; see [docs/push-notifications.md](docs/push-notifications.md).
- `apps/*/lib/services` holds business-logic/service-layer code — put non-trivial DB/domain logic there rather than inline in routes/actions.
- Keep the admin app free of customer-facing i18n; it's internal-only and English-only by design.
