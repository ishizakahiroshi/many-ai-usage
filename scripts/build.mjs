import { context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBuildArgs } from './build-args.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const { targets, watch } = parseBuildArgs(process.argv.slice(2));

const entries = {
  background: 'src/background/index.ts',
  content: 'src/content/index.ts',
  popup: 'src/popup/main.tsx',
  options: 'src/options/main.tsx',
};

async function prepareTarget(target) {
  const outdir = join(root, 'dist', target);
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });
  await cp(join(root, 'src/extension', `${target === 'chrome' ? 'manifest.chrome' : 'manifest.firefox'}.json`), join(outdir, 'manifest.json'));
  await cp(join(root, 'src/extension/popup.html'), join(outdir, 'popup.html'));
  await cp(join(root, 'src/extension/options.html'), join(outdir, 'options.html'));
  await cp(join(root, 'src/extension/assets'), join(outdir, 'assets'), { recursive: true });
  // Language packs: add locales/<code>.json + catalog.json entry; no bundle change required.
  await cp(join(root, 'src/locales'), join(outdir, 'locales'), { recursive: true });
  return outdir;
}

async function makeContext(target) {
  const outdir = await prepareTarget(target);
  return context({
    entryPoints: Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, join(root, entry)])),
    outdir,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['es2022'],
    sourcemap: watch ? 'inline' : false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    logLevel: 'info',
  });
}

const contexts = await Promise.all(targets.map(makeContext));
if (watch) {
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log(`watching ${targets.join(', ')}`);
} else {
  await Promise.all(contexts.map((ctx) => ctx.rebuild()));
  await Promise.all(contexts.map((ctx) => ctx.dispose()));
  console.log(`built ${targets.map((target) => `dist/${target}`).join(', ')}`);
}
