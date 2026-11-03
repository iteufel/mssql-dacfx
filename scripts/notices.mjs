import { readFile, writeFile, mkdir, cp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

/** Retain upstream terms and notices from every restored NuGet package. */
export async function generateNotices() {
  const assets = JSON.parse(await readFile('dotnet/Wasm/obj/project.assets.json', 'utf8'));
  const roots = Object.keys(assets.packageFolders);
  const packages = new Map();
  for (const [id, library] of Object.entries(assets.libraries)) {
    if (library.type === 'package') packages.set(id, library.path);
  }
  // Runtime packs are SDK download dependencies rather than ordinary libraries.
  for (const dependency of assets.project.frameworks['net8.0'].downloadDependencies ?? []) {
    const version = dependency.version.match(/[\d.]+/)?.[0];
    packages.set(`${dependency.name}/${version}`, `${dependency.name.toLowerCase()}/${version}`);
  }
  await rm('licenses', { recursive: true, force: true });
  await mkdir('licenses', { recursive: true });
  const lines = [
    '# Third-party notices', '',
    'The TypeScript wrapper and C# bridge are MIT licensed. Bundled Microsoft DacFx binaries are proprietary Microsoft Distributable Code, not MIT licensed.', '',
    'Use and redistribution of those binaries are subject to the Microsoft terms in the DacFx license below. This package is independent of Microsoft and is not endorsed by Microsoft.', '',
    'Each bundled dependency retains its own license. The original license and notice files found in the restored packages are preserved under `licenses/`.', '',
    '| Dependency | License | Included terms and notices |',
    '| --- | --- | --- |',
  ];
  for (const [id, path] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    let directory;
    for (const root of roots) {
      try { await readdir(join(root, path)); directory = join(root, path); break; } catch {}
    }
    if (!directory) throw new Error(`Cannot find restored package ${id}`);
    const files = await readdir(directory);
    const nuspec = await readFile(join(directory, files.find(file => file.endsWith('.nuspec'))), 'utf8');
    const license = /<license\s+type="([^"]+)"[^>]*>([^<]+)<\/license>/.exec(nuspec);
    const licenseUrl = /<licenseUrl>([^<]+)<\/licenseUrl>/.exec(nuspec)?.[1];
    const label = id.replaceAll('/', '-');
    const selected = new Set(files.filter(file => /license|notice|copying/i.test(file) && !file.endsWith('.nupkg')));
    if (license?.[1] === 'file') selected.add(license[2].replaceAll('\\', '/'));
    const links = [];
    for (const file of selected) {
      const destination = `licenses/${label}/${file}`;
      await mkdir(join(destination, '..'), { recursive: true });
      await cp(join(directory, file), destination, { recursive: true });
      links.push(`[${file}](${destination})`);
    }
    const terms = license?.[1] === 'expression' ? license[2] : license?.[1] === 'file' ? 'See included terms' : licenseUrl ? `[Upstream terms](${licenseUrl})` : 'See upstream package';
    lines.push(`| ${id} | ${terms} | ${links.join(', ')} |`);
  }
  await writeFile('THIRD_PARTY_NOTICES.md', `${lines.join('\n')}\n`);
}
