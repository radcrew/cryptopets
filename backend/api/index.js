// Vercel function entry. vercel.json rewrites every path here, and Express routes on the
// original URL, which Vercel keeps in req.url. The app is the esbuild bundle that
// `pnpm build:vercel` writes (see scripts/bundle-vercel.cjs).
//
// Loaded through `eval('require')` so Vercel's file tracer does not analyze it. The
// bundle already contains its dependencies, and tracing it follows every path a library
// might read: pg's pgpass lookup alone points the tracer at the user's whole home folder.
// vercel.json ships the bundle with `includeFiles` instead.
const path = require('node:path');

const bundle = path.join(__dirname, '..', 'dist', 'functions', 'api', 'app.cjs');
module.exports = eval('require')(bundle).default;
