import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownWideNarrow, ArrowRight, Check, ChevronRight, Clock3, Compass,
  CloudDownload, ExternalLink, Film, Flame, Grid2X2, Heart, Link2, Menu, Play, Search, Sparkles, Upload, X,
} from 'lucide-react';
import { categories, videos, type Category, type Video } from './data';
import UploadModal from './UploadModal';
import LinkSubmitModal, { type LinkSubmissionInput } from './LinkSubmitModal';
import SubmissionManager from './SubmissionManager';
import ImportStudio from './ImportStudio';
import { createLinkSubmission, getLinkSubmissions, submissionToVideo, updateSubmissionStatus, type LinkSubmission, type SubmissionStatus } from './link-storage';
import { getUploads, readIds, uploadToVideo, writeIds, type StoredUpload } from './storage';

type Section = 'explore' | 'popular' | 'favorites' | 'history' | 'uploads' | 'submissions' | 'imports';
type Sort = 'newest' | 'views' | 'title';
const sectionNames: Record<Section, string> = {
  explore: '探索影片', popular: '熱門排行', favorites: '收藏影片', history: '最近觀看', uploads: '我的影片',
  submissions: '投稿管理',
  imports: '網址匯入',
};

function viewCount(count: number) {
  return count === 0 ? '新作品' : count >= 10000 ? `${(count / 10000).toFixed(1)} 萬次觀看` : `${count.toLocaleString()} 次觀看`;
}

function Logo({ compact = false }: { compact?: boolean }) {
  return <span className={`brand ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-mark"><span /><Play size={19} fill="currentColor" strokeWidth={0} /></span>
    <span className="brand-text">幕映<span>MUYING</span></span>
  </span>;
}

function VideoCard({ video, saved, onPlay, onSave }: { video: Video; saved: boolean; onPlay: () => void; onSave: () => void }) {
  return <article className="video-card">
    <div className="card-image-wrap">
      <button className="card-image-button" onClick={onPlay} aria-label={`播放 ${video.title}`}>
        <img src={video.thumbnail} alt="" loading="lazy" />
        <span className="card-shade" />
        <span className="card-play"><Play size={22} fill="currentColor" strokeWidth={0} /></span>
        <span className="video-duration">{video.duration}</span>
        {video.featured && <span className="card-badge"><Sparkles size={10} /> 精選</span>}
        {(video.sourceKind || video.serverStored) && <span className="card-source-badge">{video.providerLabel}</span>}
      </button>
      <button className={`save-button ${saved ? 'is-saved' : ''}`} onClick={onSave} aria-label={`${saved ? '取消收藏' : '收藏'} ${video.title}`} aria-pressed={saved}>
        <Heart size={16} fill={saved ? 'currentColor' : 'none'} />
      </button>
    </div>
    <div className="card-details">
      <span className="category-caption">{video.category}</span>
      <h3><button onClick={onPlay}>{video.title}</button></h3>
      <div className="card-meta"><span>{video.creator}</span><span className="meta-dot" /><span>{viewCount(video.views)}</span></div>
    </div>
  </article>;
}

export default function App() {
  const [section, setSection] = useState<Section>('imports');
  const [category, setCategory] = useState<Category>('全部影片');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [favorites, setFavorites] = useState(() => readIds('muying-favorites'));
  const [history, setHistory] = useState(() => readIds('muying-history'));
  const [uploads, setUploads] = useState<Video[]>([]);
  const [submissions, setSubmissions] = useState<LinkSubmission[]>([]);
  const [serverVideos, setServerVideos] = useState<Video[]>([]);
  const [player, setPlayer] = useState<Video | null>(null);
  const [playerError, setPlayerError] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(6);
  const [layout, setLayout] = useState<'grid' | 'compact'>('grid');
  const [toast, setToast] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const uploadUrls = useRef<string[]>([]);
  const featured = videos.find(video => video.featured) ?? videos[0];

  function notify(message: string) {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(''), 3200);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/library', { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.videos)) setServerVideos(data.videos);
    }).catch(() => { /* The import page displays connection status. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getUploads().then(items => {
      if (cancelled) return;
      const loaded = items.map(uploadToVideo);
      uploadUrls.current.push(...loaded.flatMap(video => [video.videoUrl, video.thumbnail].filter(url => url.startsWith('blob:'))));
      setUploads(existing => [...existing, ...loaded.filter(video => !existing.some(item => item.id === video.id))]);
    }).catch(() => {
      if (!cancelled) notify('瀏覽器未開放影片儲存空間；探索與播放仍可使用。');
    });
    getLinkSubmissions().then(items => {
      if (!cancelled) setSubmissions(existing => [...existing, ...items.filter(item => !existing.some(record => record.id === item.id))]);
    }).catch(() => {
      if (!cancelled) notify('目前無法讀取投稿。請確認瀏覽器允許儲存網站資料。');
    });
    return () => {
      cancelled = true;
      clearTimeout(toastTimer.current);
      uploadUrls.current.forEach(url => URL.revokeObjectURL(url));
      uploadUrls.current = [];
    };
  }, []);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !player && !uploadOpen && !linkOpen) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [player, uploadOpen, linkOpen]);

  useEffect(() => {
    if (!player && !uploadOpen && !linkOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="dialog"] button, [role="dialog"] input')?.focus());
    function handleKeys(event: KeyboardEvent) {
      if (event.key === 'Escape') { setPlayer(null); setUploadOpen(false); setLinkOpen(false); }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector('[role="dialog"]');
      const elements = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), video[controls], a[href]') ?? []).filter(element => element.offsetParent !== null);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    window.addEventListener('keydown', handleKeys);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeys);
      previousFocus?.focus();
    };
  }, [Boolean(player), uploadOpen, linkOpen]);

  const linkedVideos = useMemo(() => submissions.filter(item => item.status === 'approved').map(submissionToVideo), [submissions]);
  const pendingSubmissions = submissions.filter(item => item.status === 'pending').length;
  const library = useMemo(() => [...serverVideos, ...uploads, ...linkedVideos, ...videos], [serverVideos, uploads, linkedVideos]);
  const filteredVideos = useMemo(() => {
    let result = library.filter(video => {
      if (section === 'favorites' && !favorites.includes(video.id)) return false;
      if (section === 'history' && !history.includes(video.id)) return false;
      if (section === 'uploads' && !video.uploaded && !video.submissionId && !video.serverStored) return false;
      if (category !== '全部影片' && video.category !== category) return false;
      return `${video.title} ${video.creator} ${video.category} ${video.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
    });
    result = [...result].sort((a, b) => sort === 'views' ? b.views - a.views : sort === 'title' ? a.title.localeCompare(b.title, 'zh-Hant') : b.date.localeCompare(a.date));
    if (section === 'history' && sort === 'newest') result.sort((a, b) => history.indexOf(a.id) - history.indexOf(b.id));
    return result;
  }, [library, section, favorites, history, category, search, sort]);

  function navigate(next: Section) {
    setSection(next);
    setCategory('全部影片');
    setSearch('');
    setSort(next === 'popular' ? 'views' : 'newest');
    setVisibleCount(6);
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleFavorite(video: Video) {
    const next = favorites.includes(video.id) ? favorites.filter(id => id !== video.id) : [...favorites, video.id];
    setFavorites(next);
    const persisted = writeIds('muying-favorites', next);
    notify(persisted ? next.includes(video.id) ? '已加入收藏影片' : '已取消收藏' : '收藏已更新，但瀏覽器未允許保存。');
  }

  function play(video: Video) {
    setPlayerError(false);
    setPlayer(video);
    const next = [video.id, ...history.filter(id => id !== video.id)].slice(0, 100);
    setHistory(next);
    writeIds('muying-history', next);
  }

  function uploaded(upload: StoredUpload) {
    const video = uploadToVideo(upload);
    uploadUrls.current.push(...[video.videoUrl, video.thumbnail].filter(url => url.startsWith('blob:')));
    setUploads(items => [video, ...items]);
    setUploadOpen(false);
    navigate('uploads');
    notify('影片已保存到這個瀏覽器。');
  }

  async function submitLink(input: LinkSubmissionInput) {
    const submission = await createLinkSubmission(input);
    setSubmissions(items => [submission, ...items]);
    setLinkOpen(false);
    navigate('submissions');
    notify('連結已保存到待整理；加入片庫後會出現在首頁。');
  }

  async function changeSubmissionStatus(id: string, status: SubmissionStatus) {
    const updated = await updateSubmissionStatus(id, status);
    setSubmissions(items => items.map(item => item.id === id ? updated : item));
    notify(status === 'approved' ? '已加入你的片庫，現在可在首頁找到。' : status === 'rejected' ? '已移至暫不收錄，可隨時重新整理。' : '已移回待整理，首頁已移除這部影片。');
  }

  const showHero = section === 'explore' && category === '全部影片' && !search.trim();
  const title = search.trim() ? `「${search.trim()}」的搜尋結果` : section === 'explore' ? category === '全部影片' ? '發現更多好影片' : category : sectionNames[section];
  const navItems = [
    { id: 'explore' as const, icon: Compass, label: '探索影片' },
    { id: 'popular' as const, icon: Flame, label: '熱門排行' },
    { id: 'favorites' as const, icon: Heart, label: '收藏影片', count: favorites.filter(id => library.some(video => video.id === id)).length },
    { id: 'history' as const, icon: Clock3, label: '最近觀看' },
  ];

  return <div className="app-shell">
    {mobileOpen && <button className="sidebar-backdrop" aria-label="關閉導覽" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-is-open' : ''}`} aria-label="主導覽">
      <button className="brand-link" onClick={() => navigate('explore')} aria-label="幕映首頁"><Logo /></button>
      <div className="sidebar-label">發現你的靈感</div>
      <nav className="primary-nav">
        {navItems.map(item => <button key={item.id} className={`nav-item ${section === item.id ? 'active' : ''}`} aria-label={item.label} onClick={() => navigate(item.id)} aria-current={section === item.id ? 'page' : undefined}>
          <item.icon size={19} strokeWidth={1.7} /><span>{item.label}</span>{Boolean(item.count) && <span className="nav-count">{item.count}</span>}
        </button>)}
      </nav>
      <div className="sidebar-divider" />
      <div className="sidebar-label">我的空間</div>
      <button className={`nav-item ${section === 'imports' ? 'active' : ''}`} aria-label="網址匯入" onClick={() => navigate('imports')} aria-current={section === 'imports' ? 'page' : undefined}><CloudDownload size={19} strokeWidth={1.7} /><span>網址匯入</span><span className="nav-new">NEW</span></button>
      <button className={`nav-item ${section === 'uploads' ? 'active' : ''}`} aria-label="我的影片" onClick={() => navigate('uploads')} aria-current={section === 'uploads' ? 'page' : undefined}><Film size={19} strokeWidth={1.7} /><span>我的影片</span>{uploads.length + linkedVideos.length + serverVideos.length > 0 && <span className="nav-count">{uploads.length + linkedVideos.length + serverVideos.length}</span>}</button>
      <button className={`nav-item ${section === 'submissions' ? 'active' : ''}`} aria-label="投稿管理" onClick={() => navigate('submissions')} aria-current={section === 'submissions' ? 'page' : undefined}><Link2 size={19} strokeWidth={1.7} /><span>投稿管理</span>{pendingSubmissions > 0 && <span className="nav-count">{pendingSubmissions}</span>}</button>
      <div className="sidebar-bottom">
        <div className="creator-note"><span className="creator-icon"><Sparkles size={18} /></span><h3>把影片留在幕映</h3><p>貼上網址，建立你的網站片庫。</p><button onClick={() => navigate('imports')}>開始匯入影片 <ArrowRight size={15} /></button></div>
        <div className="sidebar-footer"><span className="online-dot" /> 為好故事而生<span>© 2026 MUYING</span></div>
      </div>
    </aside>

    <div className="workspace">
      <header className="topbar">
        <button className="mobile-menu icon-button" aria-label="開啟導覽" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><Menu size={22} /></button>
        <div className="breadcrumbs"><span>幕映</span><ChevronRight size={13} /><strong>{sectionNames[section]}</strong></div>
        <label className="search-box"><Search size={18} /><input ref={searchRef} aria-label="搜尋影片" placeholder="搜尋影片、創作者或關鍵字…" value={search} onChange={event => { if (section === 'submissions' || section === 'imports') setSection('explore'); setSearch(event.target.value); setVisibleCount(6); }} />{search ? <button aria-label="清除搜尋" onClick={() => setSearch('')}><X size={15} /></button> : <kbd>/</kbd>}</label>
        <div className="header-actions"><span className="local-mode-pill">網站片庫</span><button className="header-link-button" aria-label="網址匯入" onClick={() => navigate('imports')}><CloudDownload size={16} /><span>網址匯入</span></button><button className="header-file-button" aria-label="上傳影片" title="上傳本機影片" onClick={() => setUploadOpen(true)}><Upload size={15} /></button><button className="avatar-button" onClick={() => navigate('uploads')} aria-label="前往我的影片">M</button></div>
      </header>

      <main className="main-content">
        {section === 'imports' ? <ImportStudio onLibraryChange={items => { if (items) setServerVideos(items); }} onPlay={play} /> : section === 'submissions' ? <SubmissionManager submissions={submissions} onStatusChange={changeSubmissionStatus} onSubmit={() => setLinkOpen(true)} onPreview={submission => play(submissionToVideo(submission))} /> : <>
        {showHero && <>
          <div className="page-heading"><div><p className="eyebrow">A SPACE FOR EVERY STORY</p><h1>好故事，總有下一幕<span>。</span></h1><p className="page-subtitle">在這裡，遇見不同的視角，也留下屬於你的光影。</p></div><span className="curated-label"><span /> 精選靈感・每日發現</span></div>
          {featured && <section className="feature-banner" aria-label="編輯精選">
            <img className="feature-image" src={featured.thumbnail} alt="" fetchPriority="high" />
            <div className="feature-gradient" />
            <div className="feature-content"><span className="feature-kicker"><span /> EDITOR'S PICK <span className="kicker-divider" /> 本週精選</span><h2>{featured.title}</h2><p>{featured.description}</p><div className="feature-actions"><button className="watch-button" onClick={() => play(featured)}><Play size={15} fill="currentColor" />立即觀看</button><button className={`feature-save ${favorites.includes(featured.id) ? 'saved' : ''}`} aria-label={favorites.includes(featured.id) ? '取消收藏精選影片' : '收藏精選影片'} aria-pressed={favorites.includes(featured.id)} onClick={() => toggleFavorite(featured)}><Heart size={18} fill={favorites.includes(featured.id) ? 'currentColor' : 'none'} /></button><span className="feature-duration">{featured.category}<span />{featured.duration}</span></div></div>
            <div className="feature-corner"><span>01</span><div /><span>FEATURED FILM</span></div>
          </section>}
        </>}

        <section className="catalogue" aria-labelledby="catalogue-heading">
          <div className="catalogue-heading"><div className="catalogue-title"><span className="section-accent" /><h2 id="catalogue-heading">{title}</h2><span className="result-count">{filteredVideos.length} 部影片</span></div><div className="catalogue-tools"><label className="sort-select"><ArrowDownWideNarrow size={15} /><select aria-label="影片排序" value={sort} onChange={event => setSort(event.target.value as Sort)}><option value="newest">最新上架</option><option value="views">最多觀看</option><option value="title">標題排序</option></select></label><button className={`layout-button ${layout === 'compact' ? 'compact-selected' : ''}`} aria-label={layout === 'grid' ? '切換為緊密排列' : '切換為一般排列'} onClick={() => setLayout(layout === 'grid' ? 'compact' : 'grid')}><Grid2X2 size={18} /></button></div></div>
          <div className="category-tabs" aria-label="影片分類">{categories.map(item => <button key={item} aria-pressed={category === item} className={category === item ? 'selected' : ''} onClick={() => { setCategory(item); setVisibleCount(6); }}>{item === '全部影片' && <Compass size={14} />}{item}</button>)}</div>
          {filteredVideos.length > 0 ? <>
            <div className={`video-grid ${layout === 'compact' ? 'compact-grid' : ''}`}>{filteredVideos.slice(0, visibleCount).map(video => <VideoCard key={video.id} video={video} saved={favorites.includes(video.id)} onPlay={() => play(video)} onSave={() => toggleFavorite(video)} />)}</div>
            {filteredVideos.length > visibleCount && <div className="load-more-wrap"><button className="load-more" onClick={() => setVisibleCount(count => count + 6)}>探索更多影片 <ArrowRight size={15} /></button><span>已顯示 {Math.min(visibleCount, filteredVideos.length)} / {filteredVideos.length} 部影片</span></div>}
          </> : <div className="empty-state"><span className="empty-icon">{section === 'favorites' ? <Heart size={30} /> : section === 'uploads' ? <Upload size={30} /> : search ? <Search size={30} /> : <Film size={30} />}</span><h3>{search ? '還沒找到這段故事' : section === 'favorites' ? '為喜歡的故事留個位置' : section === 'uploads' ? '你的第一段故事，從這裡開始' : section === 'history' ? '下一段故事，等你發現' : '這個分類還沒有影片'}</h3><p>{search ? '試試其他關鍵字，或查看所有影片。' : section === 'favorites' ? '點擊影片上的愛心，就能隨時回來觀看。' : section === 'uploads' ? '貼上影片網址，存進網站片庫；也能上傳到目前瀏覽器。' : section === 'history' ? '開始觀看影片，你的觀看紀錄會出現在這裡。' : '換個分類看看，或上傳自己的作品。'}</p><button className="watch-button" onClick={() => section === 'uploads' ? navigate('imports') : navigate('explore')}>{section === 'uploads' ? '匯入影片' : '探索所有影片'}<ArrowRight size={15} /></button></div>}
        </section>
        </>}
        <footer className="main-footer"><Logo compact /><p>每一段故事，都值得被看見。</p><span>網址匯入保存至網站 · 本機上傳與投稿保存至瀏覽器</span></footer>
      </main>
    </div>

    {player && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setPlayer(null); }}><section className="player-modal" role="dialog" aria-modal="true" aria-labelledby="player-title"><div className="player-top"><span><span className="online-dot" /> {player.serverStored ? '網站片庫 · 已儲存' : player.sourceKind ? player.providerLabel : player.uploaded ? '瀏覽器影片' : '示範片段'}</span><button className="icon-button" aria-label="關閉播放器" onClick={() => setPlayer(null)}><X size={22} /></button></div><div className="player-screen">{player.sourceKind === 'youtube' || player.sourceKind === 'vimeo' ? <iframe key={player.id} src={player.videoUrl} title={`播放 ${player.title}`} allow="fullscreen; picture-in-picture; encrypted-media" sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /> : <video ref={videoRef} key={player.id} controls autoPlay playsInline poster={player.thumbnail} src={player.videoUrl} onError={() => setPlayerError(true)} />}{playerError && <div className="player-error"><Film size={30} /><p>這部影片目前無法播放。</p><button onClick={() => { setPlayerError(false); videoRef.current?.load(); }}>重新載入</button></div>}</div><div className="player-info"><div><span className="category-caption">{player.category}</span><h2 id="player-title">{player.title}</h2><p className="player-author">{player.creator}<span>·</span>{viewCount(player.views)}</p></div><button className={`player-save ${favorites.includes(player.id) ? 'is-saved' : ''}`} onClick={() => toggleFavorite(player)} aria-pressed={favorites.includes(player.id)}><Heart size={17} fill={favorites.includes(player.id) ? 'currentColor' : 'none'} />{favorites.includes(player.id) ? '已收藏' : '收藏影片'}</button></div><p className="player-description">{player.description}</p>{player.sourceUrl && <p className="player-source-note"><span>{player.serverStored ? '影片已儲存在網站片庫，播放使用網站上的檔案。' : `播放由 ${player.providerLabel} 提供；若無法播放，可開啟來源頁面。`}</span><a href={player.sourceUrl} target="_blank" rel="noopener noreferrer">在來源網站開啟<ExternalLink size={12} /></a></p>}{!player.uploaded && !player.sourceKind && !player.serverStored && <p className="demo-note">此影片為版面示範，播放內容使用原創動態片段。</p>}</section></div>}
    {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} onUploaded={uploaded} />}
    {linkOpen && <LinkSubmitModal onClose={() => setLinkOpen(false)} onSubmit={submitLink} />}
    {toast && <div className="toast" role="status"><span><Check size={14} /></span>{toast}</div>}
  </div>;
}
