/**
 * Bundle the Vercel handler into one CJS file for the function in `api/index.js`. The
 * handler is the Express app plus the background work a serverless host needs (see
 * src/serverless/handler.ts).
 *
 * The tsc output cannot be deployed as it is: it resolves `@config/*`, `@features/*` and
 * the workspace packages through `module-alias` at runtime, which Vercel's file tracing
 * cannot follow, so the function would ship without most of its code. esbuild resolves
 * the tsconfig paths and the workspace packages at build time instead.
 *
 * The output sits two levels below `dist/` on purpose: `src/grpc/gameData.ts` looks for
 * `../../proto/cryptopets.proto` relative to its own file, which from here is the
 * `dist/proto/` copy that `copy-proto.cjs` writes.
 */
const path = require('node:path');
const esbuild = require('esbuild');

const entry = path.resolve(__dirname, '../src/serverless/handler.ts');
const outfile = path.resolve(__dirname, '../dist/functions/api/app.cjs');

esbuild
    .build({
        entryPoints: [entry],
        outfile,
        bundle: true,
        platform: 'node',
        format: 'cjs',
        target: 'node20',
        tsconfig: path.resolve(__dirname, '../tsconfig.json'),
        // Optional native add-ons that their packages load inside try/catch.
        external: ['pg-native', 'bufferutil', 'utf-8-validate'],
        logLevel: 'info',
    })
    .then(() => {
        console.log(`[bundle-vercel] ${entry} -> ${outfile}`);
    })
    .catch((err) => {
        console.error('[bundle-vercel] failed:', err);
        process.exit(1);
    });
