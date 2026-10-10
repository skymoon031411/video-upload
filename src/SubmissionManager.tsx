import { useState } from 'react';
import { ArrowRight, Check, ExternalLink, Film, Link2, LoaderCircle, Play, RotateCcw, X } from 'lucide-react';
import { type LinkSubmission, type SubmissionStatus } from './link-storage';
import './submissions.css';

type Props = {
  submissions: LinkSubmission[];
  onStatusChange: (id: string, status: SubmissionStatus) => Promise<void>;
  onSubmit: () => void;
  onPreview: (submission: LinkSubmission) => void;
};
const statusLabels: Record<SubmissionStatus, string> = { pending: '待整理', approved: '已加入片庫', rejected: '暫不收錄' };

export default function SubmissionManager({ submissions, onStatusChange, onSubmit, onPreview }: Props) {
  const [filter, setFilter] = useState<SubmissionStatus>('pending');
  const [working, setWorking] = useState<string[]>([]);
  const [error, setError] = useState('');
  const items = [...submissions].filter(item => item.status === filter).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  async function changeStatus(id: string, status: SubmissionStatus) {
    if (working.includes(id)) return;
    setWorking(ids => [...ids, id]);
    setError('');
    try { await onStatusChange(id, status); }
    catch { setError('投稿尚未更新成功。請確認瀏覽器允許儲存資料，再試一次。'); }
    finally { setWorking(ids => ids.filter(item => item !== id)); }
  }

  return <section className="submissions-section" aria-labelledby="submissions-title">
    <div className="submission-heading"><div><p className="eyebrow">CURATE YOUR COLLECTION</p><h1 id="submissions-title">把好故事，加入片庫<span>。</span></h1><p>查看投稿、整理連結，建立你的影片收藏。</p></div><button className="watch-button" onClick={onSubmit}><Link2 size={15} />提交影片連結</button></div>
    <div className="submission-mode-note"><span>瀏覽器試用版</span><p>投稿與片庫只保存在目前瀏覽器。加入片庫後會顯示在你的首頁，方便先試用完整流程。</p></div>
    <div className="submission-tabs" aria-label="投稿狀態">{(['pending', 'approved', 'rejected'] as const).map(status => <button key={status} aria-pressed={status === filter} className={status === filter ? 'selected' : ''} onClick={() => setFilter(status)}>{statusLabels[status]}<span>{submissions.filter(item => item.status === status).length}</span></button>)}</div>
    {error && <p className="submission-error" role="alert">{error}</p>}
    {items.length ? <div className="submission-list">{items.map(item => {
      const busy = working.includes(item.id);
      return <article key={item.id} className="submission-item"><div className="submission-cover"><Film size={30} strokeWidth={1.3} /><span>{item.providerLabel}</span></div><div className="submission-detail"><div className="submission-tags"><span>{item.category}</span><span>{statusLabels[item.status]}</span></div><h2>{item.title}</h2><p className="submission-byline"><span className="submission-creator">{item.creator}</span><span>·</span><time dateTime={item.createdAt}>{new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'short', day: 'numeric' }).format(new Date(item.createdAt))}</time></p>{item.description && <p className="submission-description">{item.description}</p>}<div className="submission-source"><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.providerLabel} 來源頁面<ExternalLink size={11} /></a><button onClick={() => onPreview(item)}><Play size={11} />預覽影片</button></div></div><div className="submission-actions">{busy ? <span className="submission-working"><LoaderCircle size={16} />儲存中…</span> : item.status === 'pending' ? <><button className="submission-approve" disabled={busy} onClick={() => changeStatus(item.id, 'approved')}><Check size={14} />加入片庫</button><button className="submission-decline" disabled={busy} onClick={() => changeStatus(item.id, 'rejected')}><X size={13} />暫不收錄</button></> : <button className="submission-return" disabled={busy} onClick={() => changeStatus(item.id, 'pending')}><RotateCcw size={13} />移回待整理</button>}</div></article>;
    })}</div> : <div className="empty-state submission-empty"><span className="empty-icon"><Link2 size={30} /></span><h3>{filter === 'pending' ? '下一段故事，等你投稿' : filter === 'approved' ? '片庫裡的好故事，由你決定' : '目前沒有暫不收錄的投稿'}</h3><p>{filter === 'pending' ? '貼上影片分享連結，填寫標題與分類，就能開始整理。' : filter === 'approved' ? '在「待整理」裡選擇加入片庫，影片就會出現在這裡。' : '暫不收錄的投稿會留在這裡，也能重新移回待整理。'}</p>{filter === 'pending' && <button className="watch-button" onClick={onSubmit}>提交影片連結<ArrowRight size={15} /></button>}</div>}
  </section>;
}
