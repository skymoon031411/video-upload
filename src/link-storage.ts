import { openDatabase } from './storage';
import { parseVideoLink, type ParsedVideoLink } from './links';
import { categories, type Video } from './data';
import type { LinkSubmissionInput } from './LinkSubmitModal';

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';
export type LinkSubmission = Omit<LinkSubmissionInput, 'link'> & ParsedVideoLink & {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: SubmissionStatus;
};

export async function getLinkSubmissions(): Promise<LinkSubmission[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('links', 'readonly');
    const request = transaction.objectStore('links').getAll();
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('目前無法讀取投稿。')); };
  });
}

async function putSubmission(submission: LinkSubmission): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('links', 'readwrite');
    transaction.objectStore('links').put(submission);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('投稿尚未保存。')); };
  });
}

export async function createLinkSubmission(input: LinkSubmissionInput): Promise<LinkSubmission> {
  const parsed = parseVideoLink(input.link);
  const title = input.title.trim();
  if (!title) throw new Error('請填寫影片標題。');
  if (!categories.includes(input.category) || input.category === '全部影片') throw new Error('請選擇有效的影片分類。');
  const now = new Date().toISOString();
  const submission: LinkSubmission = {
    ...parsed,
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `link-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    title: title.slice(0, 80),
    creator: input.creator.trim().slice(0, 50) || '匿名投稿',
    category: input.category,
    description: input.description.trim().slice(0, 500),
    createdAt: now,
    updatedAt: now,
    status: 'pending',
  };
  await putSubmission(submission);
  return submission;
}

export async function updateSubmissionStatus(id: string, status: SubmissionStatus): Promise<LinkSubmission> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('links', 'readwrite');
    const store = transaction.objectStore('links');
    let updated: LinkSubmission;
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) { transaction.abort(); return; }
      updated = { ...request.result, status, updatedAt: new Date().toISOString() };
      store.put(updated);
    };
    transaction.oncomplete = () => { db.close(); resolve(updated); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('投稿不存在或目前無法更新，請重新整理後再試。')); };
  });
}

export function submissionToVideo(submission: LinkSubmission): Video {
  return {
    id: `link-${submission.id}`,
    title: submission.title,
    creator: submission.creator,
    category: submission.category,
    duration: '外部影片',
    views: 0,
    date: submission.updatedAt,
    thumbnail: '/media/link-placeholder.svg',
    videoUrl: submission.playbackUrl,
    sourceKind: submission.kind,
    sourceUrl: submission.sourceUrl,
    providerLabel: submission.providerLabel,
    submissionId: submission.id,
    description: submission.description,
  };
}
