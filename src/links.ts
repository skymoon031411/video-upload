export type ParsedVideoLink = {
  kind: 'youtube' | 'vimeo' | 'direct';
  sourceUrl: string;
  playbackUrl: string;
  providerLabel: string;
};

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const YOUTUBE_SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
const YOUTUBE_PRIVATE_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_HASH = /^[A-Za-z0-9]{1,64}$/;

function isPrivateIpv4(parts: number[]): boolean {
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function ipv6Words(hostname: string): number[] {
  // URL already validates and normalizes IPv6 literals, including dotted IPv4 tails.
  const address = hostname.slice(1, -1);
  const [left, right] = address.split('::');
  const first = left ? left.split(':').map(word => Number.parseInt(word, 16)) : [];
  if (right === undefined) return first;
  const last = right ? right.split(':').map(word => Number.parseInt(word, 16)) : [];
  return [...first, ...Array<number>(8 - first.length - last.length).fill(0), ...last];
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host === 'localhost.localdomain'
    || /\.(?:localhost|local|internal|lan|home)$/.test(host)) return true;

  // WHATWG URL converts integer, hexadecimal and abbreviated IPv4 hosts to dotted form.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    return isPrivateIpv4(host.split('.').map(Number));
  }

  if (host.startsWith('[')) {
    const words = ipv6Words(host);
    const [first, second] = words;
    if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80
      || (first & 0xffc0) === 0xfec0 || (first & 0xff00) === 0xff00
      || (first === 0x2001 && second === 0x0db8)) return true;
    if (words.slice(0, 6).every(word => word === 0)) return true;
    const mappedIpv4 = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
    const nat64 = first === 0x64 && second === 0xff9b && words.slice(2, 6).every(word => word === 0);
    if (mappedIpv4 || nat64) {
      return isPrivateIpv4([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255]);
    }
    return false;
  }

  // A hostname without a dot identifies a local network name rather than a public website.
  return !host.includes('.');
}

function youtubeLink(url: URL): ParsedVideoLink {
  let id: string | undefined;
  if (YOUTUBE_SHORT_HOSTS.has(url.hostname)) {
    id = /^\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
  } else if (YOUTUBE_PRIVATE_HOSTS.has(url.hostname)) {
    id = /^\/embed\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
  } else if (/^\/watch\/?$/.test(url.pathname)) {
    const values = url.searchParams.getAll('v');
    if (values.length === 1) id = values[0];
  } else {
    id = /^\/(?:shorts|embed)\/([A-Za-z0-9_-]+)\/?$/.exec(url.pathname)?.[1];
  }

  if (!id || !YOUTUBE_ID.test(id)) {
    throw new Error('請使用有效的 YouTube 影片連結；影片代碼須為 11 個英數字、底線或連字號。');
  }

  return {
    kind: 'youtube',
    sourceUrl: `https://www.youtube.com/watch?v=${id}`,
    playbackUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
    providerLabel: 'YouTube',
  };
}

function vimeoLink(url: URL): ParsedVideoLink {
  const match = url.hostname === 'player.vimeo.com'
    ? /^\/video\/(\d+)\/?$/.exec(url.pathname)
    : /^\/(\d+)(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!match) throw new Error('請使用 Vimeo 的數字影片網址，或 player.vimeo.com/video/影片代碼。');

  const hashes = url.searchParams.getAll('h');
  const pathHash = match[2];
  const queryHash = hashes[0];
  if (hashes.length > 1 || (hashes.length === 1 && !queryHash)
    || (pathHash && queryHash && pathHash !== queryHash)) {
    throw new Error('Vimeo 的未公開影片代碼重複、缺漏或不一致，請重新複製完整連結。');
  }
  const hash = pathHash ?? queryHash;
  if (hash && !VIMEO_HASH.test(hash)) {
    throw new Error('Vimeo 的未公開影片代碼只能包含英數字，長度不可超過 64 個字元。');
  }

  const id = match[1];
  return {
    kind: 'vimeo',
    sourceUrl: `https://vimeo.com/${id}${hash ? `/${hash}` : ''}`,
    playbackUrl: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ''}`,
    providerLabel: 'Vimeo',
  };
}

/** Parse supported public HTTPS video links without network requests or side effects. */
export function parseVideoLink(input: string): ParsedVideoLink {
  if (typeof input !== 'string' || !input.trim()) throw new Error('請貼上要投稿的影片連結。');
  if (input.length > 4096) throw new Error('影片連結太長，最多可輸入 4096 個字元。');

  const value = input.trim();
  if (/[<>]/.test(value)) throw new Error('請只貼上影片網址，不要貼 iframe 或其他 HTML 嵌入碼。');
  if (/[\s\\\u0000-\u001f\u007f]/.test(value)) {
    throw new Error('影片網址不能含空白、反斜線或控制字元；請重新複製完整網址。');
  }
  if (!/^https:\/\//i.test(value)) throw new Error('影片連結必須使用 HTTPS（https://）。');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('這不是有效的影片網址，請確認網域與網址格式。');
  }
  if (url.protocol !== 'https:') throw new Error('影片連結必須使用 HTTPS（https://）。');
  if (url.username || url.password) throw new Error('影片網址不能包含帳號或密碼。');
  if (isLocalHost(url.hostname)) throw new Error('請使用公開網站的影片連結，不支援 localhost、內網或保留 IP 位址。');

  if (YOUTUBE_HOSTS.has(url.hostname) || YOUTUBE_SHORT_HOSTS.has(url.hostname)
    || YOUTUBE_PRIVATE_HOSTS.has(url.hostname) || VIMEO_HOSTS.has(url.hostname)) {
    if (url.port) throw new Error('YouTube 與 Vimeo 連結不能使用自訂連接埠。');
    return VIMEO_HOSTS.has(url.hostname) ? vimeoLink(url) : youtubeLink(url);
  }

  if (/\.(?:mp4|webm|ogg|ogv)$/i.test(url.pathname)) {
    return { kind: 'direct', sourceUrl: url.href, playbackUrl: url.href, providerLabel: '影片直連' };
  }
  throw new Error('目前支援 YouTube、Vimeo，或以 .mp4、.webm、.ogg、.ogv 結尾的 HTTPS 影片直連；不支援一般網頁或 .m3u8。');
}
