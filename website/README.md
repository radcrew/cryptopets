# CryptoPets marketing site

Next.js landing page (`website/`). The playable app lives in `frontend/`.

## Local development

```bash
# From repo root
pnpm dev:web
```

Copy `env.example` to `.env.local` and set:

- `NEXT_PUBLIC_APP_URL` — the local or deployed **app** URL, used by the "Play Now" CTA.
- `NEXT_PUBLIC_SITE_URL` — the public origin of **this site**, used for canonical
  URLs, `sitemap.xml`, `robots.txt` and Open Graph tags. It defaults to
  `http://localhost:3002`, so a production deploy that leaves it unset publishes a
  canonical tag and sitemap pointing at localhost. The two are different domains;
  do not reuse `NEXT_PUBLIC_APP_URL` here.

## Deployment

Not deployed from this repo: it runs on localhost only. The Vercel setup (`website/vercel.json`
and `scripts/vercel-website-link.mjs`) was removed; `git log --diff-filter=D -- website/vercel.json`
finds the commit. When it is deployed again, set `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_SITE_URL`
there as described above.
