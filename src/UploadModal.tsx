import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { AlertCircle, ArrowUpRight, Check, Film, HardDrive, LoaderCircle, LockKeyhole, UploadCloud, X } from 'lucide-react';
import { categories, type Category } from './data';
import { saveUpload, type StoredUpload } from './storage';
import './upload.css';

const MAX_FILE_SIZE = 250 * 1024 * 1024;
const uploadCategories = categories.filter((category) => category !== '全部影片');

function formatDuration(seconds: number): string {
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

function createPoster(video: HTMLVideoElement | null): Promise<Blob | undefined> {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth, 960);
      canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
      const context = canvas.getContext('2d');
      if (!context) { resolve(undefined); return; }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/jpeg', 0.84);
    } catch { resolve(undefined); }
  });
}

export default function UploadModal({ onClose, onUploaded }: {
  onClose: () => void;
  onUploaded: (upload: StoredUpload) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileVersion, setFileVersion] = useState(0);
  const [fileUrl, setFileUrl] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>(uploadCategories[0]);
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState(0);
  const [playable, setPlayable] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chooseButtonRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragDepth = useRef(0);
  const closeRef = useRef(onClose);
  const savingRef = useRef(saving);

  useEffect(() => { closeRef.current = onClose; savingRef.current = saving; }, [onClose, saving]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => chooseButtonRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!savingRef.current) closeRef.current();
      }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type="file"]), textarea:not([disabled]), select:not([disabled]), video[controls]') ?? []);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); event.stopPropagation(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); event.stopPropagation(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, []);

  useEffect(() => {
    if (!file) { setFileUrl(''); return; }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, fileVersion]);

  useEffect(() => {
    if (!fileUrl || playable || error) return;
    const timeout = window.setTimeout(() => setError('影片讀取逾時。請重新選擇檔案，或改用 MP4 / WebM 格式。'), 20000);
    return () => window.clearTimeout(timeout);
  }, [fileUrl, playable, error]);

  function chooseFile(nextFile: File | undefined) {
    if (!nextFile || saving) return;
    setError('');
    setPlayable(false);
    setDuration(0);
    setFile(null);
    if (!nextFile.type.startsWith('video/') && !/\.(mp4|webm|ogg|ogv)$/i.test(nextFile.name)) {
      setError('請選擇影片檔案，例如 MP4、WebM 或 Ogg。');
      return;
    }
    if (nextFile.size > MAX_FILE_SIZE) { setError('影片超過 250 MB，請先縮小檔案後再上傳。'); return; }
    if (!nextFile.size) { setError('這個檔案是空的，請選擇其他影片。'); return; }
    setFile(nextFile);
    setFileVersion((version) => version + 1);
    setTitle((current) => current || nextFile.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || savingRef.current) return;
    if (!file || !playable || !Number.isFinite(duration) || duration <= 0) {
      setError('請先選擇檔案，並等待影片完成讀取。'); return;
    }
    if (!title.trim()) { setError('請為影片填寫標題。'); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    let upload: StoredUpload;
    try {
      const poster = await createPoster(videoRef.current);
      upload = {
        id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        title: title.trim(), category, description: description.trim(),
        date: new Date().toISOString(), duration: formatDuration(duration), file,
        ...(poster ? { poster } : {}),
      };
      await saveUpload(upload);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
        setError('瀏覽器的儲存空間不足，請選擇較小的影片，或清理儲存空間後重試。');
      } else {
        setError('影片尚未儲存成功。請確認瀏覽器允許網站儲存資料，然後重試。');
      }
      savingRef.current = false;
      setSaving(false);
      return;
    }
    onUploaded(upload);
  }

  return (
    <div className="upload-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <div ref={dialogRef} className="upload-dialog" role="dialog" aria-modal="true" aria-labelledby="upload-title">
        <div className="upload-heading">
          <div className="upload-heading-icon"><UploadCloud size={23} strokeWidth={1.7} /></div>
          <div><div className="upload-eyebrow">SHARE YOUR STORY</div><h2 id="upload-title">讓你的故事，被看見</h2><p>上傳一段影片，收藏生活裡值得記住的片刻。</p></div>
          <button className="upload-close" type="button" onClick={onClose} disabled={saving} aria-label="關閉上傳視窗"><X size={21} /></button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="upload-body">
            <div className="upload-file-column">
              <div className="upload-field-heading"><span>01</span> 選擇你的影片</div>
              <div className={`upload-dropzone${dragging ? ' upload-dragging' : ''}${file ? ' upload-has-file' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); if (!saving) { dragDepth.current += 1; setDragging(true); } }}
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = saving ? 'none' : 'copy'; }}
                onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
                onDrop={onDrop}>
                {file && fileUrl ? (
                  <div className="upload-preview">
                    <video key={fileUrl} ref={videoRef} src={fileUrl} controls playsInline preload="auto"
                      onLoadedMetadata={(event) => {
                        const seconds = event.currentTarget.duration;
                        if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds);
                        else { setPlayable(false); setError('無法讀取影片長度，請改用其他檔案。'); }
                      }}
                      onCanPlay={(event) => {
                        const seconds = event.currentTarget.duration;
                        if (Number.isFinite(seconds) && seconds > 0 && event.currentTarget.videoWidth > 0 && event.currentTarget.videoHeight > 0) {
                          setDuration(seconds); setPlayable(true);
                        } else {
                          setPlayable(false); setError('檔案沒有可播放的影像，請選擇其他影片。');
                        }
                      }}
                      onError={() => { setPlayable(false); setError('目前瀏覽器無法播放這個影片。請改用支援的 MP4 或 WebM 檔案。'); }} />
                    <div className="upload-file-info"><Film size={17} /><span title={file.name}>{file.name}</span><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></div>
                    <div className="upload-file-status">{playable ? <><Check size={14} /> 已準備好 · {formatDuration(duration)}</> : error ? <><AlertCircle size={14} /> 影片尚未通過格式檢查</> : <><LoaderCircle size={14} className="upload-spin" /> 正在檢查影片格式…</>}</div>
                  </div>
                ) : (
                  <><div className="upload-drop-icon"><UploadCloud size={34} strokeWidth={1.3} /></div><h3>把影片拖曳到這裡</h3><p>每一個平凡的瞬間，都值得留存。</p></>
                )}
                <button ref={chooseButtonRef} className="upload-select-file" type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}>{file ? '重新選擇影片' : '選擇影片'}<ArrowUpRight size={16} /></button>
                <input ref={fileInputRef} className="upload-file-input" type="file" accept="video/*,.mp4,.webm,.ogg,.ogv" aria-label="選擇影片檔案" disabled={saving} onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ''; }} />
                <p className="upload-format-note">MP4、WebM、Ogg · 檔案大小上限 250 MB</p>
              </div>
              <div className="upload-local-note"><HardDrive size={17} /><p>影片僅保存在目前瀏覽器，重新整理後仍可觀看。<span>清除網站資料後，影片也會一併移除。</span></p></div>
            </div>
            <div className="upload-details-column">
              <div className="upload-field-heading"><span>02</span> 加上一點故事</div>
              <label className="upload-label" htmlFor="upload-video-title">影片標題 <span>*</span></label>
              <input className="upload-text-input" id="upload-video-title" placeholder="為這一刻，取個名字" value={title} maxLength={80} required disabled={saving} onChange={(event) => setTitle(event.target.value)} />
              <div className="upload-character-count">{title.length} / 80</div>
              <label className="upload-label" htmlFor="upload-video-category">影片分類 <span>*</span></label>
              <select className="upload-text-input upload-category" id="upload-video-category" value={category} disabled={saving} onChange={(event) => setCategory(event.target.value as Category)}>{uploadCategories.map((item) => <option key={item} value={item}>{item}</option>)}</select>
              <label className="upload-label upload-description-label" htmlFor="upload-video-description">影片描述 <small>選填</small></label>
              <textarea className="upload-text-input upload-description" id="upload-video-description" placeholder="關於這段影片，你想說的話…" value={description} maxLength={500} disabled={saving} onChange={(event) => setDescription(event.target.value)} />
              <div className="upload-character-count">{description.length} / 500</div>
              {error && <div className="upload-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}
            </div>
          </div>
          <div className="upload-footer"><span><LockKeyhole size={15} /> 你的私人影片收藏</span><div><button className="upload-cancel" type="button" onClick={onClose} disabled={saving}>取消</button><button className="upload-submit" type="submit" disabled={saving || !playable || !title.trim()}>{saving ? <><LoaderCircle size={17} className="upload-spin" /> 正在儲存…</> : <><UploadCloud size={17} /> 儲存影片</>}</button></div></div>
        </form>
      </div>
    </div>
  );
}
