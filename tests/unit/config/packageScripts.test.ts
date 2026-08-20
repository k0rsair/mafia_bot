import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

type PackageManifest = Readonly<{
  scripts?: Readonly<Record<string, string>>;
  allowScripts?: Readonly<Record<string, boolean>>;
}>;

describe('Prisma client generation lifecycle', () => {
  it('generates the Prisma client after installation and before every application start', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as PackageManifest;

    expect(manifest.scripts).toMatchObject({
      postinstall: 'prisma generate',
      predev: 'prisma generate',
      prestart: 'prisma generate',
    });
  });

  it('allows only the reviewed dependency scripts required to run Prisma and tsx', async () => {
    const manifest = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')) as PackageManifest;

    expect(manifest.allowScripts).toEqual({
      '@prisma/client': true,
      '@prisma/engines': true,
      esbuild: true,
      prisma: true,
    });
  });
});
