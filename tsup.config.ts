import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  minify: true,
  target: 'node18',
  outDir: 'dist',
  clean: true,
  bundle: true,
});
