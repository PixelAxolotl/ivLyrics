import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildReleaseBatch, selectReleaseRange } from '../.github/scripts/prepare_release_notifications.mjs';
import {
  buildReleaseWebhookMessages, normalizeDiscordWebhookUrl,
  postReleaseWebhookMessage, sendReleaseWebhook, verifyReleaseWebhookMessage
} from '../.github/scripts/send_release_webhook.mjs';

const repository = 'ivLis-Studio/ivLyrics';
const webhook = 'https://discord.com/api/webhooks/123/synthetic-test-token';
const releases = [21, 22, 23, 24, 25, 26].map(number => ({
  tag_name: `v6.6.${number}`, name: `Release ${number}`,
  html_url: `https://github.com/${repository}/releases/tag/v6.6.${number}`,
  body: `# v6.6.${number}\n\n한국어 릴리스 노트 ${number}\n\nEnglish notes ${number}\n`,
  draft: false, prerelease: false
}));

test('backfill selects published stable releases after the last announcement in version order', () => {
  const source = [...releases].reverse().concat([
    { ...releases[0], tag_name: 'v6.6.27', draft: true },
    { ...releases[0], tag_name: 'v6.6.28', prerelease: true },
    { ...releases[0], tag_name: 'v6.6.29-beta' }
  ]);
  assert.deepEqual(selectReleaseRange(source, 'v6.6.21').map(release => release.tag_name), ['v6.6.22', 'v6.6.23', 'v6.6.24', 'v6.6.25', 'v6.6.26']);
  assert.deepEqual(selectReleaseRange(source, 'v6.6.21', 'v6.6.23').map(release => release.tag_name), ['v6.6.22', 'v6.6.23']);
});

test('invalid or reversed ranges and missing notes stop preparation before sending', () => {
  for (const [after, through] of [['v6.6.20', ''], ['v6.6.21', 'v6.6.99'], ['v6.6.23', 'v6.6.22'], ['v6.6.21', 'v6.6.21']]) {
    assert.throws(() => selectReleaseRange(releases, after, through));
  }
  assert.throws(() => selectReleaseRange(releases.map(release => ({ ...release, body: '' })), 'v6.6.21'), /no published notes/);
});

test('one batch preserves every bilingual note, links and chronological release order without mentions', () => {
  const selected = selectReleaseRange(releases, 'v6.6.21');
  const batch = buildReleaseBatch(selected);
  const messages = buildReleaseWebhookMessages({ ...batch, now: 0 });
  assert.equal(batch.tag, 'v6.6.22 ~ v6.6.26');
  assert.equal(batch.releaseUrl, releases.at(-1).html_url);
  assert.equal(messages.map(message => message.embeds[0].description).join(''), batch.body);
  for (const release of selected) assert.ok(batch.body.includes(release.body.trim()));
  assert.ok(batch.body.indexOf('# v6.6.22') < batch.body.indexOf('# v6.6.26'));
  assert.ok(messages.every(message => message.allowed_mentions.parse.length === 0));
});

test('long notes retain all text across Discord-size chunks including emoji', () => {
  const body = ('한국어 English 🎵\n').repeat(1000);
  const messages = buildReleaseWebhookMessages({ platform: 'pc', tag: 'v6.6.26', title: 'Roundup', body, releaseUrl: releases.at(-1).html_url });
  assert.ok(messages.length > 1);
  assert.ok(messages.every(message => message.embeds[0].description.length <= 4096));
  assert.equal(messages.map(message => message.embeds[0].description).join(''), body);
});

test('successful webhook delivery requires a created-message receipt', async () => {
  assert.equal(new URL(normalizeDiscordWebhookUrl(webhook)).searchParams.get('wait'), 'true');
  const receipt = { id: '456', channel_id: '789' };
  assert.deepEqual(await postReleaseWebhookMessage(webhook, {}, { fetchImpl: async () => Response.json(receipt) }), receipt);
  await assert.rejects(postReleaseWebhookMessage(webhook, {}, { fetchImpl: async () => Response.json({}) }), /message receipt/);
});

test('rate limiting retries while rejected webhook credentials are not retried', async () => {
  const delays = [];
  let calls = 0;
  await postReleaseWebhookMessage(webhook, {}, {
    fetchImpl: async () => ++calls === 1 ? Response.json({ retry_after: 0.7 }, { status: 429 }) : Response.json({ id: '456', channel_id: '789' }),
    sleep: async delay => delays.push(delay)
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [700]);
  calls = 0;
  await assert.rejects(postReleaseWebhookMessage(webhook, {}, { fetchImpl: async () => { calls++; return new Response(null, { status: 401 }); } }), /HTTP 401/);
  assert.equal(calls, 1);
});

test('verification rereads the saved message and retries only reads after a rate limit', async () => {
  const receipt = { id: '456', channel_id: '789' };
  const message = { content: 'Released', embeds: [{ description: '한국어 English' }] };
  const calls = [];
  const verified = await verifyReleaseWebhookMessage(normalizeDiscordWebhookUrl(webhook), receipt, message, {
    fetchImpl: async (url, init) => {
      calls.push([url, init]);
      return calls.length === 1 ? Response.json({ retry_after: 0.1 }, { status: 429 }) : Response.json({ ...receipt, ...message });
    }, sleep: async () => {}
  });
  assert.deepEqual(verified, { messageId: '456', channelId: '789' });
  assert.ok(calls.every(([url, init]) => url.endsWith('/messages/456') && init === undefined));
  await assert.rejects(verifyReleaseWebhookMessage(webhook, receipt, message, { fetchImpl: async () => Response.json({ ...receipt, ...message, content: 'other' }) }), /saved content/);
});

test('batch delivery records partial receipts and uses the latest release URL for the range', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'ivlyrics-webhook-test-'));
  try {
    const notesPath = join(folder, 'notes.md');
    await writeFile(notesPath, '한국어\nEnglish');
    const recorded = [];
    let sent;
    const result = await sendReleaseWebhook({
      RELEASE_WEBHOOK_URL: webhook, RELEASE_PLATFORM: 'pc', RELEASE_TAG: 'v6.6.22 ~ v6.6.26',
      RELEASE_TITLE: 'Roundup', RELEASE_URL: releases.at(-1).html_url,
      RELEASE_NOTES_PATH: notesPath, GITHUB_REPOSITORY: repository
    }, {
      fetchImpl: async (url, init) => {
        if (init?.method === 'POST') sent = JSON.parse(init.body);
        return Response.json({ id: '456', channel_id: '789', ...sent });
      }, onReceipt: async receipt => recorded.push(receipt), now: 0
    });
    assert.equal(sent.embeds[0].url, releases.at(-1).html_url);
    assert.equal(sent.embeds[0].description, await readFile(notesPath, 'utf8'));
    assert.deepEqual(recorded.map(receipt => receipt.verified), [false, true]);
    assert.deepEqual(result, [{ messageId: '456', channelId: '789' }]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
