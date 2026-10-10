import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, ChevronRight, Clock3, Cloud, CloudDownload, Film, HardDrive, KeyRound, Link2, LoaderCircle, Play, RefreshCw, Search, ShieldCheck, WifiOff } from 'lucide-react';
import { categories, type Category, type Video } from './data';
import './import-studio.css';

type Candidate = { id: string; label: string; url: string; mime: string; durationSeconds?: number; preview: boolean };
type Inspection = { inspectionId: string; sourceUrl: string; title: string; candidates: Candidate[]; message?: string };
type Job = { id: string; title: string; sourceUrl: string; status: 'queued' | 'downloading' | 'verifying' | 'completed' | 'failed'; progress: number | null; downloadedBytes: number; totalBytes: number | null; error?: string; videoId?: string; createdAt: string };
type ServerVideo = Video & { bytes?: number; durationSeconds?: number };
type Health = { requiresAuth?: boolean; authRequired?: boolean; authConfigured?: boolean; mode?: string; storage?: string | { usedBytes?: number; videoCount?: number }; maxBytes?: number };
type Props = { onLibraryChange: (videos?: Video[]) => void; onPlay: (video: Video) => void };

class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}
function readableMessage(value: unknown, token = '') {
  if (typeof value !== 'string' || /<\/?(?:html|script|body)/i.test(value)) return '伺服器無法完成這個請求，請稍後再試。';
  let text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 500);
  if (token) text = text.split(token).join('［已隱藏］');
  return text || '伺服器無法完成這個請求，請稍後再試。';
}
function formatBytes(value?: number | null) {
  if (!value || !Number.isFinite(value)) return '0 B';
  const unit = Math.min(3, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toFixed(unit ? 1 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}
function formatDuration(value?: number) {
  if (!value || !Number.isFinite(value)) return '長度將於匯入後檢查';
  return `${Math.floor(value / 60)} 分 ${Math.floor(value % 60)} 秒`;
}
function sourceHost(value: string) { try { return new URL(value).hostname; } catch { return '影片來源'; } }
const jobLabels: Record<Job['status'], string> = { queued: '等待匯入', downloading: '儲存至網站', verifying: '檢查影片', completed: '已存入片庫', failed: '匯入失敗' };

export default function ImportStudio({ onLibraryChange, onPlay }: Props) {
  const [health, setHealth] = useState<Health | null>(null);
  const [online, setOnline] = useState<'checking' | 'online' | 'offline'>('checking');
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [authNeeded, setAuthNeeded] = useState(false);
  const [authUnconfigured, setAuthUnconfigured] = useState(false);
  const [authConnected, setAuthConnected] = useState(false);
  const [statusError, setStatusError] = useState('');
  const [url, setUrl] = useState('');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('旅行紀錄');
  const [minMinutes, setMinMinutes] = useState('10');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [library, setLibrary] = useState<ServerVideo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [connectionRevision, setConnectionRevision] = useState(0);
  const mounted = useRef(false);
  const inspectSequence = useRef(0);
  const inspectController = useRef<AbortController | null>(null);
  const callbacks = useRef({ onLibraryChange, onPlay });
  callbacks.current = { onLibraryChange, onPlay };
  const previousJobs = useRef(new Map<string, Job['status']>());
  const sourceInput = useRef<HTMLInputElement>(null);

  const request = useCallback(async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
    const headers = new Headers(options.headers);
    if (options.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try { response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' }); }
    catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError('無法連線到影片匯入伺服器，請確認網站服務已啟動。', 0);
    }
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new ApiError('影片匯入服務尚未啟動；目前只有網站介面可用。', response.status); }
    if (!response.ok) {
      const data = body as { message?: unknown; error?: unknown; code?: string };
      throw new ApiError(readableMessage(data?.message ?? data?.error, token), response.status, data?.code);
    }
    return body as T;
  }, [token]);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof ApiError && (error.status === 401 || error.code === 'authentication_required')) {
      setAuthNeeded(true); setAuthConnected(false);
      return '請連接管理員權杖，以使用伺服器匯入功能。';
    }
    if (error instanceof ApiError && error.status === 503 && /(?:token|權杖|管理員|auth|設定)/i.test(error.message)) {
      setAuthUnconfigured(true); setAuthConnected(false);
    }
    return readableMessage(error instanceof Error ? error.message : '', token);
  }, [token]);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    const results = await Promise.allSettled([
      request<{ jobs: Job[] } | Job[]>('/api/imports', { signal }),
      request<{ videos: ServerVideo[] }>('/api/library', { signal }),
    ]);
    if (!mounted.current || signal?.aborted) return;
    const jobsResult = results[0];
    if (jobsResult.status === 'fulfilled') {
      const next = Array.isArray(jobsResult.value) ? jobsResult.value : jobsResult.value.jobs;
      if (Array.isArray(next)) {
        const finished = next.filter(job => job.status === 'completed' && previousJobs.current.has(job.id) && previousJobs.current.get(job.id) !== 'completed');
        setJobs(next);
        previousJobs.current = new Map(next.map(job => [job.id, job.status]));
        if (finished.length) setAnnouncement(`${finished.length} 部影片已存入網站片庫。`);
      }
      setAuthNeeded(false); setAuthConnected(Boolean(token)); setStatusError('');
    } else if (!(jobsResult.reason instanceof DOMException && jobsResult.reason.name === 'AbortError')) {
      setStatusError(handleError(jobsResult.reason));
    }
    const libraryResult = results[1];
    if (libraryResult.status === 'fulfilled' && Array.isArray(libraryResult.value.videos)) {
      setLibrary(libraryResult.value.videos);
      callbacks.current.onLibraryChange(libraryResult.value.videos);
    }
  }, [request, token, handleError]);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    const refresh = async () => {
      if (running || controller.signal.aborted || document.visibilityState === 'hidden') return;
      running = true;
      await loadData(controller.signal);
      running = false;
      if (!controller.signal.aborted) timer = setTimeout(refresh, 2000);
    };
    const visibility = () => {
      if (timer) clearTimeout(timer);
      if (document.visibilityState === 'visible') void refresh();
    };
    void (async () => {
      try {
        const data = await request<Health>('/api/health', { signal: controller.signal });
        if (!mounted.current || controller.signal.aborted) return;
        setHealth(data); setOnline('online');
        setAuthUnconfigured(data.authConfigured === false && Boolean(data.requiresAuth ?? data.authRequired));
        await refresh();
      } catch (error) {
        if (controller.signal.aborted || !mounted.current) return;
        setOnline('offline'); setStatusError(handleError(error));
      }
    })();
    document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false; controller.abort(); inspectController.current?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [request, loadData, handleError, connectionRevision]);

  const clearInspection = () => {
    inspectSequence.current += 1;
    inspectController.current?.abort();
    setInspecting(false); setInspection(null); setCandidateId(''); setConfirmed(false); setInspectError(''); setAnnouncement('');
  };
  const inspectSource = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!url.trim() || submitting || inspecting) return;
    const sequence = ++inspectSequence.current;
    inspectController.current?.abort();
    const controller = new AbortController(); inspectController.current = controller;
    setInspecting(true); setInspectError(''); setInspection(null); setConfirmed(false); setAnnouncement('正在檢查來源頁面。');
    try {
      const result = await request<Inspection>('/api/inspect', { method: 'POST', body: JSON.stringify({ url: url.trim() }), signal: controller.signal });
      if (!mounted.current || sequence !== inspectSequence.current) return;
      if (!result.inspectionId || !Array.isArray(result.candidates)) throw new ApiError('伺服器回傳的來源資訊不完整，請重新檢查。', 502);
      setInspection(result); setTitle(result.title || '我的影片');
      const eligible = result.candidates.find(candidate => !candidate.preview);
      setCandidateId(eligible?.id ?? '');
      setAnnouncement(eligible ? '來源檢查完成，請確認要儲存的完整影片。' : '來源檢查完成，目前沒有可匯入的正片來源。');
    } catch (error) {
      if (!mounted.current || sequence !== inspectSequence.current || controller.signal.aborted) return;
      setInspectError(handleError(error)); setAnnouncement('來源檢查未完成。');
    } finally { if (mounted.current && sequence === inspectSequence.current) setInspecting(false); }
  };
  const createImport = async (event: FormEvent) => {
    event.preventDefault();
    const minutes = Number(minMinutes);
    const candidate = inspection?.candidates.find(item => item.id === candidateId);
    if (!inspection || !candidate || candidate.preview || !confirmed || submitting || !title.trim() || !Number.isFinite(minutes) || minutes < 1 || minutes > 240) return;
    setSubmitting(true); setInspectError(''); setAnnouncement('正在建立匯入任務。');
    try {
      const result = await request<{ job: Job }>('/api/imports', { method: 'POST', body: JSON.stringify({ inspectionId: inspection.inspectionId, candidateId, title: title.trim(), category, minDurationSeconds: Math.round(minutes * 60), confirmedRights: true, confirmedFullLength: true }) });
      if (!mounted.current) return;
      if (!result.job?.id) throw new ApiError('伺服器未回傳匯入任務，請重新整理確認後再試。', 502);
      setJobs(current => [result.job, ...current.filter(job => job.id !== result.job.id)]);
      previousJobs.current.set(result.job.id, result.job.status);
      setConfirmed(false); setAnnouncement('任務已建立，影片將由伺服器儲存到網站片庫。');
      await loadData();
    } catch (error) { if (mounted.current) { setInspectError(handleError(error)); setAnnouncement('未能建立匯入任務。'); } }
    finally { if (mounted.current) setSubmitting(false); }
  };
  const refreshManually = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const data = await request<Health>('/api/health');
      if (mounted.current) {
        setHealth(data); setOnline('online');
        setAuthUnconfigured(data.authConfigured === false && Boolean(data.requiresAuth ?? data.authRequired));
        await loadData();
        if (mounted.current) setConnectionRevision(current => current + 1);
      }
    } catch (error) { if (mounted.current) { setOnline('offline'); setStatusError(handleError(error)); } }
    finally { if (mounted.current) setRefreshing(false); }
  };
  const connectAdmin = (event: FormEvent) => {
    event.preventDefault(); if (!tokenInput.trim()) return;
    setToken(tokenInput.trim()); setTokenInput(''); setStatusError('');
  };
  const retryJob = (job: Job) => {
    clearInspection(); setUrl(job.sourceUrl); setTitle(job.title);
    sourceInput.current?.focus(); sourceInput.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setAnnouncement('已填入來源網址，請重新檢查影片後再匯入。');
  };
  const totalBytes = library.reduce((sum, video) => sum + (video.bytes ?? 0), 0);
  const activeJobs = jobs.filter(job => ['queued', 'downloading', 'verifying'].includes(job.status)).length;
  const selectedCandidate = inspection?.candidates.find(candidate => candidate.id === candidateId);
  const validMinimum = Number.isFinite(Number(minMinutes)) && Number(minMinutes) >= 1 && Number(minMinutes) <= 240;
  const cannotImport = !selectedCandidate || selectedCandidate.preview || !confirmed || !title.trim() || !validMinimum || submitting || online !== 'online' || authNeeded || authUnconfigured;

  return <section className="import-studio" aria-labelledby="import-studio-title">
    <div className="import-studio-heading"><div><p className="eyebrow">MUYING · SERVER LIBRARY</p><h1 id="import-studio-title">把影片，<span>留在幕映。</span></h1><p>貼上來源網址，檢查正片，再存入網站片庫。</p></div><span className={`import-server-pill ${online === 'online' ? 'is-online' : ''}`}><span />{online === 'checking' ? '連接伺服器中' : online === 'online' ? '網站伺服器已連線' : '伺服器未連線'}</span></div>
    <div className="import-overview"><div className="import-intro"><div className="import-cloud-art" aria-hidden="true"><div className="import-art-ring"/><div className="import-art-cloud"><Cloud size={42} strokeWidth={1.3}/><span><Check size={16}/></span></div><span className="import-art-film"><Film size={19}/></span></div><div><span className="import-small-label">你的網站，就是你的片庫</span><h2>儲存一次，隨時播放。</h2><p>影片由網站伺服器下載與保存，<br/>不會把檔案下載到你的裝置。</p></div></div><div className="import-storage-stat"><HardDrive size={18}/><span>網站儲存空間</span><strong>{formatBytes(totalBytes)}</strong><small>{library.length} 部已儲存影片{activeJobs ? ` · ${activeJobs} 個進行中任務` : ''}</small></div></div>
    {(online === 'offline' || authUnconfigured) && <div className="import-service-alert" role="status"><WifiOff size={20}/><div><strong>{authUnconfigured ? '伺服器尚未設定管理員權杖' : '匯入服務尚未連線'}</strong><p>{authUnconfigured ? '請在網站伺服器設定管理員權杖後重新啟動服務，完成後即可匯入影片。' : statusError || '請啟動網站的伺服器服務後重新連線。影片匯入需要伺服器儲存空間。'}</p></div><button type="button" onClick={() => void refreshManually()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'import-spinning' : ''}/>重新連線</button></div>}
    {(authNeeded || (Boolean(health?.requiresAuth ?? health?.authRequired) && !authConnected)) && !authUnconfigured && online === 'online' && <form className="import-auth-panel" onSubmit={connectAdmin}><KeyRound size={19}/><div><strong>連接管理員</strong><p>匯入影片需要管理員權杖；僅保留在此頁的記憶體中。</p></div><label className="import-sr-only" htmlFor="import-admin-token">管理員權杖</label><input id="import-admin-token" type="password" autoComplete="off" value={tokenInput} onChange={event => setTokenInput(event.target.value)} placeholder="輸入管理員權杖" maxLength={512}/><button type="submit" disabled={!tokenInput.trim()}>連接<ArrowRight size={14}/></button>{authNeeded && token && <p className="import-auth-error">權杖無效，請重新輸入。</p>}</form>}
    {authConnected && <div className="import-auth-connected"><ShieldCheck size={14}/>管理員已連接<button type="button" disabled={submitting || inspecting} onClick={() => { setToken(''); setAuthConnected(false); clearInspection(); }}>中斷連接</button></div>}
    {statusError && online === 'online' && !authNeeded && !authUnconfigured && <p className="import-inline-error" role="alert"><AlertCircle size={15}/>{statusError}</p>}
    <div className="import-workspace"><div className="import-source-panel"><div className="import-panel-heading"><span className="import-step-number">01</span><div><h2>加入影片來源</h2><p>公開影片網址，或含有影片的網頁網址</p></div><Link2 size={19}/></div><form className="import-url-form" onSubmit={event => void inspectSource(event)}><label htmlFor="import-source-url">來源網址</label><div className="import-url-field"><Link2 size={17}/><input ref={sourceInput} id="import-source-url" type="url" placeholder="https://example.com/video" required maxLength={4096} value={url} onChange={event => { clearInspection(); setUrl(event.target.value); }} disabled={submitting} autoComplete="off" spellCheck={false}/></div><button className="import-primary-button" type="submit" disabled={!url.trim() || inspecting || submitting || online !== 'online' || authUnconfigured || authNeeded}>{inspecting ? <LoaderCircle size={17} className="import-spinning"/> : <Search size={17}/>} {inspecting ? '正在檢查來源…' : '檢查影片來源'}{!inspecting && <ArrowRight size={15}/>}</button></form><div className="import-supported-note"><ShieldCheck size={15}/><p>可匯入有儲存授權、可直接取得的影片。登入、付費或受保護的播放器，可能無法取得完整影片。</p></div><div className="import-process"><span><Link2 size={12}/>貼上網址</span><ChevronRight size={11}/><span><Search size={12}/>確認正片</span><ChevronRight size={11}/><span><CloudDownload size={12}/>存入網站</span></div></div>
      <div className="import-selection-panel"><div className="import-panel-heading"><span className="import-step-number">02</span><div><h2>確認要儲存的影片</h2><p>保留正片，排除預告與試看片</p></div></div>
        {!inspection && !inspecting && !inspectError && <div className="import-source-empty"><div className="import-source-empty-icon"><Film size={29} strokeWidth={1.2}/><span><Search size={13}/></span></div><h3>從一個網址開始</h3><p>完成來源檢查後，可用的影片會顯示在這裡。<br/>你可以確認片名、來源與最低影片長度。</p></div>}
        {inspecting && <div className="import-source-empty"><LoaderCircle size={30} className="import-spinning"/><h3>正在讀取來源資訊</h3><p>尋找網頁中可直接取得的影片來源。</p></div>}
        {inspectError && <div className="import-inspect-error" role="alert"><AlertCircle size={22}/><strong>這次未能完成</strong><p>{inspectError}</p><small>請確認來源網址，或提供有授權的完整影片直接網址。</small></div>}
        {inspection && <form onSubmit={event => void createImport(event)} className="import-selection-form"><div className="import-inspection-source"><CheckCircle2 size={15}/><span>來源檢查完成</span><small>{sourceHost(inspection.sourceUrl)}</small></div>{inspection.message && <p className="import-inspection-message">{readableMessage(inspection.message, token)}</p>}
          {inspection.candidates.length > 0 ? <fieldset className="import-candidates"><legend>選擇影片來源</legend>{inspection.candidates.map(candidate => <label key={candidate.id} className={`import-candidate ${candidate.preview ? 'is-preview' : ''} ${candidate.id === candidateId ? 'is-selected' : ''}`}><input type="radio" name="import-candidate" value={candidate.id} checked={candidate.id === candidateId} disabled={candidate.preview || submitting} onChange={() => { setCandidateId(candidate.id); setConfirmed(false); }}/><span className="import-candidate-icon"><Film size={18}/></span><span className="import-candidate-details"><strong>{candidate.label || '影片來源'}</strong><small>{candidate.preview ? '預告／試看片不可匯入' : formatDuration(candidate.durationSeconds)}</small></span><span className={`import-candidate-tag ${candidate.preview ? 'is-preview' : ''}`}>{candidate.preview ? '試看片' : '可選來源'}</span></label>)}</fieldset> : <div className="import-no-candidates"><Film size={24}/><strong>沒有可直接取得的正片</strong><p>這個頁面可能只提供商品資訊或試看片。請提供有儲存授權的完整影片直接網址。</p></div>}
          {inspection.candidates.some(candidate => !candidate.preview) && <><label className="import-field" htmlFor="import-video-title">影片名稱<input id="import-video-title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={160} disabled={submitting}/></label><div className="import-field-row"><label className="import-field" htmlFor="import-video-category">影片分類<select id="import-video-category" value={category} onChange={event => setCategory(event.target.value as Category)} disabled={submitting}>{categories.filter(item => item !== '全部影片').map(item => <option key={item}>{item}</option>)}</select></label><label className="import-field" htmlFor="import-min-minutes">最低影片長度<div className="import-duration-field"><input id="import-min-minutes" type="number" min={1} max={240} step={1} required value={minMinutes} onChange={event => setMinMinutes(event.target.value)} disabled={submitting}/><span>分鐘</span></div></label></div><p className="import-length-note"><Clock3 size={13}/>匯入後會驗證長度；時長無法證明影片完整，請自行確認來源。</p><label className="import-rights-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={submitting}/><span>我有儲存授權，且已確認這是完整影片</span></label><button className="import-primary-button" type="submit" disabled={cannotImport}>{submitting ? <LoaderCircle size={17} className="import-spinning"/> : <CloudDownload size={17}/>} {submitting ? '正在建立任務…' : '存入網站片庫'}<ArrowRight size={15}/></button></>}
        </form>}
      </div>
    </div>
    <div className="import-jobs-panel"><div className="import-jobs-heading"><div><span className="import-step-number">03</span><h2>匯入任務</h2><span className="import-job-count">{jobs.length}</span></div><button type="button" onClick={() => void refreshManually()} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'import-spinning' : ''}/><span>重新整理</span></button></div>
      {jobs.length === 0 ? <div className="import-jobs-empty"><CloudDownload size={24} strokeWidth={1.4}/><div><strong>你的第一部影片，正在等你加入。</strong><p>建立匯入任務後，可以在這裡查看進度與結果。</p></div><span>存入網站 · 隨時播放</span></div> : <div className="import-job-list">{jobs.map(job => {
        const video = library.find(item => item.id === job.videoId);
        const progress = typeof job.progress === 'number' && Number.isFinite(job.progress) ? Math.min(100, Math.max(0, job.progress)) : null;
        const isWorking = ['queued', 'downloading', 'verifying'].includes(job.status);
        return <article className={`import-job is-${job.status}`} key={job.id}><div className="import-job-icon">{job.status === 'completed' ? <CheckCircle2 size={21}/> : job.status === 'failed' ? <AlertCircle size={21}/> : isWorking ? <CloudDownload size={21}/> : <Film size={21}/>}</div><div className="import-job-detail"><h3>{job.title}</h3><p>{sourceHost(job.sourceUrl)}<span>·</span>{job.status === 'completed' ? '已儲存於網站伺服器' : `${formatBytes(job.downloadedBytes)}${job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ''}`}</p>{isWorking && <div className={`import-progress ${progress === null ? 'is-unknown' : ''}`} role="progressbar" aria-label={`${job.title}匯入進度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined} aria-valuetext={progress === null ? jobLabels[job.status] : `${Math.round(progress)}%`}><span style={{ width: progress === null ? '30%' : `${progress}%` }}/></div>}{job.error && <p className="import-job-error">{readableMessage(job.error, token)}</p>}</div><div className="import-job-action"><span className={`import-job-status is-${job.status}`}>{job.status === 'completed' ? <Check size={12}/> : isWorking ? <LoaderCircle size={12} className="import-spinning"/> : null}{jobLabels[job.status] || '狀態更新中'}{job.status === 'downloading' && progress !== null ? ` ${Math.round(progress)}%` : ''}</span>{job.status === 'completed' && video && <button type="button" className="import-play-button" onClick={() => callbacks.current.onPlay(video)}><Play size={13} fill="currentColor"/>播放影片</button>}{job.status === 'failed' && <button type="button" className="import-retry-button" onClick={() => retryJob(job)}>重新檢查<ArrowRight size={12}/></button>}</div></article>;
      })}</div>}
    </div>
    <p className="import-footer-note"><HardDrive size={13}/>{health?.mode === 'local' ? '目前在此網站伺服器儲存；正式上線請使用持久化儲存空間。' : '正式上線請為網站伺服器配置持久化儲存空間。'}</p><div className="import-sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
  </section>;
}
