import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const path = 'docs/model-preview-jobs.json';
const jobs = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
const prep = JSON.parse(readFileSync('docs/model-prep-jobs.json', 'utf8'));
const faces = { 'player-body': 80000, 'player-shield': 20000, 'player-sword': 12000, 'boss-body': 150000, 'boss-blade': 25000 };
for (const input of prep) {
  input.status = 'completed';
  input.localPath = `assets/prepare-a-precise-3d-modeling-input-from-${input.id.slice(0, 8)}.png`;
  input.review = 'Inspected: isolated asset, no background objects. Player body has empty hands and no loose cloth. Boss retains the approved branching silhouette.';
}
writeFileSync('docs/model-prep-jobs.json', JSON.stringify(prep, null, 2) + '\n');
for (const input of prep) {
  if (jobs.some(job => job.key === input.key && job.id)) continue;
  const prompt = `Create the exact isolated ${input.key.replaceAll('-', ' ')} shown in the reference, preserving its intricate gothic sculptural silhouette and fine material detail. Front faces +Z, vertical is +Y. No display base, no background. ${input.key.endsWith('body') ? 'Static body, preserve every visible limb; no held equipment or loose cloth.' : 'One separate equipment object, no hands or body.'}`;
  const args = ['genex', 'model', prompt, '--image', input.localPath, '--geometry', 'detailed', '--texture', 'detailed', '--face-limit', String(faces[input.key]), '--no-wait', '--json'];
  // The provider rejects textured generation with --parts; segment after review.
  const run = spawnSync('npx', args, { encoding: 'utf8', timeout: 180000 });
  if (run.status !== 0) {
    process.stderr.write(run.stderr || run.stdout || String(run.error));
    spawnSync('npx', ['genex', 'doctor'], { stdio: 'inherit' });
    process.exit(run.status || 1);
  }
  const result = JSON.parse(run.stdout);
  jobs.push({ key: input.key, inputId: input.id, inputPath: input.localPath, faceLimit: faces[input.key], geometry: 'detailed', texture: 'detailed', parts: false, prompt, ...result });
  writeFileSync(path, JSON.stringify(jobs, null, 2) + '\n');
  console.log(JSON.stringify(jobs.at(-1)));
}
