import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildReleaseWebhookMessages, sendReleaseWebhook } from './send_release_webhook.mjs';

const repositories = {
  pc: 'ivLis-Studio/ivLyrics',
  ios: 'ivLis-Studio/ivLyrics-IOS',
  android: 'ivLis-Studio/ivLyrics-Android'
};

function version(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag || '');
  return match ? match.slice(1).map(Number) : null;
}

function compare(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function selectReleaseRange(releases, afterTag, throughTag = '') {
  const published = releases.filter(release => !release.draft && !release.prerelease && version(release.tag_name));
  const after = version(afterTag);
  if (!after || !published.some(release => release.tag_name === afterTag)) {
    throw new Error('after_tag must identify a published stable release.');
  }
  const sorted = published.sort((left, right) => compare(version(left.tag_name), version(right.tag_name)));
  const lastTag = throughTag || sorted.at(-1)?.tag_name;
  const through = version(lastTag);
  if (!through || !published.some(release => release.tag_name === lastTag) || compare(after, through) >= 0) {
    throw new Error('through_tag must identify a newer published stable release.');
  }
  const selected = sorted.filter(release => compare(version(release.tag_name), after) > 0 && compare(version(release.tag_name), through) <= 0);
  if (selected.some(release => !release.body?.trim())) throw new Error('A selected release has no published notes.');
  return selected;
}

export function buildReleaseBatch(releases) {
  if (!releases.length) throw new Error('No releases selected.');
  const first = releases[0].tag_name;
  const last = releases.at(-1).tag_name;
  const tag = first === last ? first : `${first} ~ ${last}`;
  const releaseUrl = releases.at(-1).html_url;
  const intro = `# ivLyrics PC 누락 업데이트 모음 / Release roundup\n\n${tag} (${releases.length} releases)\n\n`
    + releases.map(release => `- [${release.tag_name}](${release.html_url})`).join('\n');
  return {
    platform: 'pc', repository: repositories.pc, tag,
    title: `ivLyrics PC ${tag} — Release roundup`, releaseUrl,
    body: `${intro}\n\n${releases.map(release => release.body.trim()).join('\n\n---\n\n')}\n`
  };
}

function ghJson(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
}

export async function prepareNotifications(env = process.env) {
  let notifications;
  if (env.RELEASE_SET === 'pc-range') {
    const pages = ghJson(['api', '--paginate', '--slurp', `repos/${repositories.pc}/releases?per_page=100`]);
    notifications = [buildReleaseBatch(selectReleaseRange(pages.flat(), env.RELEASE_AFTER_TAG, env.RELEASE_THROUGH_TAG))];
  } else if (env.RELEASE_SET === 'latest-all') {
    notifications = Object.entries(repositories).map(([platform, repository]) => {
      const release = ghJson(['api', `repos/${repository}/releases/latest`]);
      if (!release.body?.trim()) throw new Error(`Latest ${platform} release has no published notes.`);
      return { platform, repository, tag: release.tag_name, title: release.name || release.tag_name, releaseUrl: release.html_url, body: release.body };
    });
  } else {
    throw new Error('RELEASE_SET must be pc-range or latest-all.');
  }
  const folder = resolve(env.RELEASE_NOTIFICATION_DIR || 'release-notifications');
  await mkdir(folder, { recursive: true });
  const manifest = [];
  for (const [index, notification] of notifications.entries()) {
    const notesPath = resolve(folder, `${index + 1}-${notification.platform}.md`);
    await writeFile(notesPath, notification.body);
    const preview = buildReleaseWebhookMessages(notification);
    await writeFile(resolve(folder, `${index + 1}-${notification.platform}-preview.json`), JSON.stringify(preview, null, 2));
    const { body, ...metadata } = notification;
    manifest.push({ ...metadata, notesPath, parts: preview.length });
    console.log(`Prepared ${notification.platform}: ${notification.tag}, ${preview.length} Discord message(s).`);
  }
  await writeFile(resolve(folder, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function sendNotifications(env = process.env) {
  const folder = resolve(env.RELEASE_NOTIFICATION_DIR || 'release-notifications');
  const manifest = JSON.parse(await readFile(resolve(folder, 'manifest.json'), 'utf8'));
  const receipts = [];
  for (const notification of manifest) {
    await sendReleaseWebhook({
      RELEASE_WEBHOOK_URL: env.RELEASE_WEBHOOK_URL,
      RELEASE_PLATFORM: notification.platform,
      RELEASE_TAG: notification.tag,
      RELEASE_TITLE: notification.title,
      RELEASE_URL: notification.releaseUrl,
      RELEASE_NOTES_PATH: notification.notesPath,
      GITHUB_REPOSITORY: notification.repository
    }, { onReceipt: async receipt => {
      const existing = receipts.findIndex(item => item.messageId === receipt.messageId);
      const item = { platform: notification.platform, tag: notification.tag, ...receipt };
      if (existing === -1) receipts.push(item);
      else receipts[existing] = item;
      await writeFile(resolve(folder, 'receipts.json'), JSON.stringify(receipts, null, 2));
    } });
  }
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entryPath === import.meta.url) {
  const command = process.argv[2];
  Promise.resolve().then(() => {
    if (command === 'prepare') return prepareNotifications();
    if (command === 'send') return sendNotifications();
    throw new Error('Use prepare or send.');
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
