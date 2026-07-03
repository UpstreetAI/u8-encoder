import { defineConfig } from 'tsup';

// Pin the output extensions so they always match the paths declared in
// package.json's "exports" map (./dist/u8.cjs and ./dist/u8.mjs). Without this,
// tsup derives extensions from the package "type" field and emits ./dist/u8.js
// for the CJS build, which breaks `require('u8-encoder')`.
export default defineConfig({
  entry: ['./u8.ts'],
  format: ['esm', 'cjs'],
  outDir: './dist',
  clean: true,
  // Emit per-format declaration files (u8.d.mts / u8.d.cts) so the types
  // resolved for the ESM and CJS entry points match their module format.
  // A single u8.d.ts would be treated as CommonJS and "masquerade as CJS"
  // when consumed via the ESM `import` condition.
  dts: true,
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.mjs' };
  },
});
