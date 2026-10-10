import assert from 'node:assert/strict';
import test from 'node:test';
import { parseVideoLink } from '../src/links.ts';

const youtubeId = 'aB3_dE5-fG7';
const expectedYoutube = {
  kind: 'youtube',
  sourceUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
  playbackUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0`,
  providerLabel: 'YouTube',
};

test('YouTube watch, mobile, shares, shorts and embeds normalize and remove tracking', () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${youtubeId}&utm_source=example&t=12#comments`,
    `https://youtube.com/watch?feature=shared&v=${youtubeId}`,
    `https://m.youtube.com/watch?v=${youtubeId}&si=example`,
    `https://youtu.be/${youtubeId}?si=example&t=20`,
    `https://www.youtu.be/${youtubeId}`,
    `https://www.youtube.com/shorts/${youtubeId}?feature=share`,
    `https://www.youtube.com/embed/${youtubeId}?autoplay=1`,
    `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1`,
    `https://youtube-nocookie.com/embed/${youtubeId}/`,
    `  https://www.youtube.com/watch?v=${youtubeId}  `,
  ]) {
    assert.deepEqual(parseVideoLink(url), expectedYoutube);
  }
  assert.ok(!expectedYoutube.playbackUrl.includes('autoplay'));
});

test('YouTube requires exactly one valid 11-character video ID and supported paths', () => {
  for (const url of [
    'https://youtu.be/short',
    'https://youtu.be/aB3_dE5-fG78',
    'https://youtu.be/aB3.dE5-fG7',
    'https://youtube.com/watch',
    `https://youtube.com/watch?v=${youtubeId}&v=12345678901`,
    'https://youtube.com/watch?v=1234567890%3C',
    `https://youtube-nocookie.com/watch?v=${youtubeId}`,
    `https://youtube.com/playlist?list=${youtubeId}`,
    `https://youtube.com:8443/watch?v=${youtubeId}`,
  ]) assert.throws(() => parseVideoLink(url), Error);
});

test('Vimeo public pages and player links normalize to one source and embed URL', () => {
  const expected = {
    kind: 'vimeo', sourceUrl: 'https://vimeo.com/123456789',
    playbackUrl: 'https://player.vimeo.com/video/123456789', providerLabel: 'Vimeo',
  };
  for (const url of [
    'https://vimeo.com/123456789',
    'https://www.vimeo.com/123456789/?utm_source=example',
    'https://player.vimeo.com/video/123456789?autoplay=1#t=30',
  ]) assert.deepEqual(parseVideoLink(url), expected);
});

test('Vimeo preserves unlisted access hashes from paths and player queries', () => {
  const expected = {
    kind: 'vimeo', sourceUrl: 'https://vimeo.com/123456789/ab12cd34ef',
    playbackUrl: 'https://player.vimeo.com/video/123456789?h=ab12cd34ef', providerLabel: 'Vimeo',
  };
  for (const url of [
    'https://vimeo.com/123456789/ab12cd34ef?utm_source=example',
    'https://vimeo.com/123456789?h=ab12cd34ef&autoplay=1',
    'https://player.vimeo.com/video/123456789?h=ab12cd34ef&autoplay=1',
    'https://vimeo.com/123456789/ab12cd34ef?h=ab12cd34ef',
  ]) assert.deepEqual(parseVideoLink(url), expected);
});

test('Vimeo rejects invalid, ambiguous or missing access hashes', () => {
  for (const url of [
    'https://vimeo.com/not-a-video',
    'https://vimeo.com/channels/example/123456789',
    'https://player.vimeo.com/video/not-a-video',
    'https://vimeo.com/123456789/ab12cd34ef/extra',
    'https://vimeo.com/123456789?h=',
    'https://vimeo.com/123456789?h=one&h=two',
    'https://vimeo.com/123456789/one?h=two',
    'https://vimeo.com/123456789/hash%2Fextra',
    `https://vimeo.com/123456789/${'a'.repeat(65)}`,
  ]) assert.throws(() => parseVideoLink(url), Error);
});

test('Direct media supports the four native extensions and preserves query tokens', () => {
  for (const extension of ['mp4', 'webm', 'ogg', 'ogv', 'MP4']) {
    const url = `https://media.example.org/path/demo.${extension}?token=sample-value%2F123&expires=123#t=2`;
    assert.deepEqual(parseVideoLink(url), {
      kind: 'direct', sourceUrl: url, playbackUrl: url, providerLabel: '影片直連',
    });
  }
  assert.equal(parseVideoLink('HTTPS://MEDIA.EXAMPLE.ORG:443/demo.mp4').sourceUrl, 'https://media.example.org/demo.mp4');
});

test('Rejects unknown HTML pages, HLS streams and deceptive provider hostname suffixes', () => {
  for (const url of [
    'https://example.org/watch?id=123',
    'https://example.org/demo.m3u8',
    'https://example.org/page.html?file=demo.mp4',
    `https://youtube.com.example.org/watch?v=${youtubeId}`,
    `https://notyoutube.com/watch?v=${youtubeId}`,
    'https://vimeo.com.example.org/123456789',
    `https://www.youtube.com@evil.example.org/watch?v=${youtubeId}`,
    `https://evil.example.org@youtube.com/watch?v=${youtubeId}`,
    'https://username:password@media.example.org/demo.mp4',
  ]) assert.throws(() => parseVideoLink(url), Error);
});

test('Rejects unsafe schemes, raw embed markup and ambiguous URL characters', () => {
  for (const value of [
    'http://media.example.org/demo.mp4',
    'javascript:alert(1)',
    'data:video/mp4;base64,AAAA',
    'srcdoc:example',
    '//media.example.org/demo.mp4',
    'https:media.example.org/demo.mp4',
    '<iframe src="https://www.youtube.com/embed/aB3_dE5-fG7"></iframe>',
    'https://media.example.org/demo.mp4\n?token=example',
    'https://media.example.org/a b.mp4',
    'https://media.example.org\\@127.0.0.1/demo.mp4',
  ]) assert.throws(() => parseVideoLink(value), Error);
});

test('Rejects localhost, private, loopback and special-use IPv4 / IPv6 forms', () => {
  for (const host of [
    'localhost', 'LOCALHOST.', 'app.localhost', 'localhost.localdomain', 'server.local', 'server',
    '127.0.0.1', '127.1', '2130706433', '0x7f000001', '0177.0.0.1',
    '0.0.0.0', '10.2.3.4', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.1.1', '192.0.2.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '[::]', '[::1]', '[fc00::1]', '[fd12::123]', '[fe80::1]', '[fec0::1]', '[ff02::1]',
    '[::ffff:127.0.0.1]', '[::ffff:10.0.0.1]', '[::127.0.0.1]', '[64:ff9b::a00:1]', '[2001:db8::1]',
  ]) {
    assert.throws(() => parseVideoLink(`https://${host}/demo.mp4`), /公開網站|有效的影片網址/);
  }
});

test('Allows public IP media links and avoids overblocking public IPv4 address ranges', () => {
  for (const host of ['8.8.8.8', '172.15.1.1', '172.32.1.1', '192.169.1.1', '[2001:4860:4860::8888]']) {
    assert.equal(parseVideoLink(`https://${host}/demo.mp4`).kind, 'direct');
  }
});

test('Validates empty, invalid and oversized input without including its value in errors', () => {
  assert.throws(() => parseVideoLink('   '), /請貼上/);
  assert.throws(() => parseVideoLink('https://[invalid]/demo.mp4'), /有效的影片網址/);
  const prefix = 'https://media.example.org/demo.mp4?token=';
  assert.equal(parseVideoLink(prefix + 'a'.repeat(4096 - prefix.length)).kind, 'direct');
  assert.throws(() => parseVideoLink(prefix + 'a'.repeat(4097 - prefix.length)), /4096/);
  const value = 'sensitive-placeholder';
  assert.throws(() => parseVideoLink(`https://${value}@media.example.org/demo.mp4`), error => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes(value));
    return true;
  });
});
