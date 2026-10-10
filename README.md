# Standalone Turf Studio

Independent coded page extracted from the original turf demo at https://turf.myagencylogics.com/. Retains photo upload, TurfHub product selection, lawn/pet/putting modes, putting shapes, sizes, borders, AI render requests, before/after comparison, color matching and image download. Adds project-plan JSON download. This is a turf tool; a separate rubber-rendering implementation was not supplied by the two URLs.

## What is included

`index.html` and `src/style.css` are the new tool-only page. `assets/` holds its browser scripts and local fonts. `src/original-visualizer.js` and `src/original-data.js` preserve the original pre-adaptation frontend source. `functions/api/turf-render.js`, `visualizer/` and `data/` hold the backend, catalog and tests. `public/img/` contains the canonical yard and product assets. Keep this folder in Git; the build regenerates frontend code in `public/` while preserving these source images. `public/` is also the ready-to-host frontend. Backend source stays outside `public/`.

Dependencies: Wrangler 4.149.0 for local Cloudflare testing, locked with its transitive versions. Application source uses browser APIs and Node's built-ins, with no runtime CDN library. You can open `index.html` directly to browse/select/upload, but real API rendering needs HTTP hosting plus the function.

Run the inherited tests with `npm test` (32 tests). `samples/yard-before.jpg` and `samples/historical-after-sierra-blend-pro.png` are existing historical render evidence from the original project, not new generations. Use them for offline/replay testing only; the saved after image represents Sierra Blend Pro.

## Own-account AI rendering setup

The source and backend are included, but credentials and old Cloudflare account bindings are deliberately excluded. The transfer defaults to `RENDERS_PAUSED=1`. Uploads and selection work without credentials; generating a new AI image requires your own configured provider.

1. Create a **new** Cloudflare Pages project in your other account, connected to your new GitHub repository. Use the entire project root, not just the public folder.
2. Build command: `npm run build`. Output directory: `public`. Framework preset: None. Set `NODE_VERSION=22`. Keep `functions/`, `visualizer/`, `data/` and `wrangler.toml` at the project root: these are required for the backend.
3. Edit `wrangler.toml` to use your new Pages project name. Create a new KV namespace in your new account. Uncomment the `kv_namespaces` block with its new ID and binding name `RENDER_KV`.
4. Add your provider key as a Pages **secret**, never in JavaScript or GitHub. Supported secret names: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `FAL_KEY`. Provider adapters use the original defaults. Set `OPENAI_MODEL` or `GEMINI_MODEL` to a model actually available to your provider account before enabling rendering. This export has not made a live provider call to verify model availability in your account.
5. Review the included usage caps. Only after the provider, budget and KV binding are configured, change `RENDERS_PAUSED` to `0` and redeploy. AI renders incur provider charges. KV caps are inherited application counters; they are not a replacement for a provider-account budget.
6. Optional bot protection: `TURNSTILE_SECRET` activates server verification. You must also install the client widget and set `window.turnstileToken` on success. Do not set only the secret: that would block all render requests. No widget is installed by this export.

For Pages Functions use Git integration or Wrangler deployment. A dashboard drag-and-drop upload of static files alone does not install `functions/`.

### Exact local commands

Node.js 22 or newer:

```sh
npm ci
npm run build
npm run dev
```

This static preview makes no paid calls; `/api/turf-render` returns a clear 503. To exercise the actual Cloudflare function locally:

```sh
npm run dev:cloudflare
```

Leave rendering paused for no-spend testing. If testing real rendering later, place secrets only in a local `.dev.vars` file (gitignored), use your new KV binding and review provider availability and budget first. No old-account .env file is included or loaded.

### Environment variables and external services

Provider secrets: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `FAL_KEY`. Optional server secret: `TURNSTILE_SECRET`. Binding: `RENDER_KV`. Controls: `RENDERS_PAUSED`, `DAILY_PER_LEAD`, `DAILY_PER_IP`, `MONTHLY_CAP`, `CACHE_DAYS`. Provider configuration: `OPENAI_MODEL`, `OPENAI_QUALITY`, `GEMINI_MODEL`.

Calls to external services are made by the function: OpenAI image edits, Google Generative Language API or fal image editing, depending on the chosen provider. Optional Turnstile uses Cloudflare verification. All 209 remote product photographs referenced by the original catalogs were downloaded into `public/img/vendor/` and mapped locally; the backend resolves their paths against the new request origin. Image provenance is in `ASSET-PROVENANCE.json`. Catalog source-page links still point to the manufacturer for reference, but rendering does not rely on its image host.

### Limits and verification

The AI pipeline uses the original provider adapters, prompt construction, validation, quality checks and browser color matching. Placement, scene fidelity and color are approximate. The model chooses putting-green placement; this is not precise CAD placement. No live AI call was made during this export. The browser result flow was tested by replaying an existing saved sample, clearly labeled in the verification report. That is a replay test, not proof of a newly generated result. Windows was not directly tested.

The original lead fields remain required by backend validation and usage limits. They do not implement an email-delivery or CRM integration. Customer photo and lead information travel to the function on a render request; the provider receives the image and image-edit prompt. Do not advertise automatic quote/email delivery until separately implemented.
