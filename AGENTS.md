# Agent notes

## Deploy

Production is https://spatial-mirror.pages.dev, a Cloudflare Pages project named `spatial-mirror`. Its `pages.dev` address is why this is Pages: a Worker URL would carry the account's `cbse-homework-worker` subdomain, and renaming that subdomain would break the account's other Workers. The relay still lives on that subdomain, which only appears in network traffic.

- `npm run deploy` runs the unit tests, builds, and publishes `dist`.
- `npm run deploy:relay` publishes the phone relay in `relay/`. Run it only after changing `relay/` or `control-room.mjs`, or to add an origin to `ALLOWED_ORIGINS`. A site on a new domain needs that origin added, or phone pairing fails with a 403.
- Authentication is `npx wrangler@4.156.0 login` on a personal machine, or `CLOUDFLARE_API_TOKEN` elsewhere, with the Cloudflare Pages: Edit permission (add Workers Scripts: Edit for the relay).
- Afterwards check the phone flow with `STUDIO_URL=<site> node tests/atp-controller-browser.mjs` and `STUDIO_URL=<site> npx tsx tests/atp-phone-camera-browser.mjs`.

A push to `main` deploys through `.github/workflows/deploy.yml` once the repo has a remote and a `CLOUDFLARE_API_TOKEN` secret.

## Dependencies

In the original checkout `node_modules` may be a symlink to `../section-studio/node_modules`. Do not run `npm ci` while it is a symlink: npm follows it and empties the shared folder. Fresh clones have no symlink, so `npm ci` is safe there.
