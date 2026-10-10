import type { Category, Video } from './data';

export type StoredUpload = {
  id: string;
  title: string;
  category: Category;
  description: string;
  date: string;
  duration: string;
  file: File;
  poster?: Blob;
};

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('muying-library', 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('videos')) request.result.createObjectStore('videos', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('links')) request.result.createObjectStore('links', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('請關閉其他幕映分頁後重試。')); };
  });
}

export async function getUploads(): Promise<StoredUpload[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('videos', 'readonly');
    const request = transaction.objectStore('videos').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('目前無法讀取影片。')); };
  });
}

export async function saveUpload(upload: StoredUpload): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('videos', 'readwrite');
    transaction.objectStore('videos').put(upload);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('影片未能保存。')); };
  });
}

export function uploadToVideo(upload: StoredUpload): Video {
  return {
    ...upload,
    creator: '我的創作',
    views: 0,
    thumbnail: upload.poster ? URL.createObjectURL(upload.poster) : '/media/upload-placeholder.svg',
    videoUrl: URL.createObjectURL(upload.file),
    uploaded: true,
  };
}

export function readIds(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch { return []; }
}

export function writeIds(key: string, ids: string[]): boolean {
  try { localStorage.setItem(key, JSON.stringify(ids)); return true; }
  catch { return false; }
}
