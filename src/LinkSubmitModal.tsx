import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowUpRight, CheckCircle2, Link2, LoaderCircle, LockKeyhole, Send, X } from 'lucide-react';
import { categories, type Category } from './data';
import { parseVideoLink } from './links';
import './link-submit.css';

export type LinkSubmissionInput = {
  title: string;
  creator: string;
  category: Category;
  description: string;
  link: string;
};

const submissionCategories = categories.filter((category) => category !== '全部影片');

export default function LinkSubmitModal({ onClose, onSubmit }: {
  onClose: () => void;
  onSubmit: (input: LinkSubmissionInput) => Promise<void>;
}) {
  const [link, setLink] = useState('');
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [category, setCategory] = useState<Category>(submissionCategories[0]);
  const [description, setDescription] = useState('');
  const [linkTouched, setLinkTouched] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  const submittingRef = useRef(false);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  const recognition = useMemo(() => {
    if (!link.trim()) return { value: undefined, error: '' };
    try { return { value: parseVideoLink(link.trim()), error: '' }; }
    catch (cause) {
      return { value: undefined, error: cause instanceof Error ? cause.message : '無法辨識影片連結，請檢查網址格式。' };
    }
  }, [link]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => linkRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!submittingRef.current) closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)') ?? []);
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!first || !last) { event.preventDefault(); event.stopPropagation(); dialogRef.current?.focus(); return; }
      if (!elements.includes(document.activeElement as HTMLElement)) { event.preventDefault(); event.stopPropagation(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); event.stopPropagation(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); event.stopPropagation(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    setError('');
    if (!link.trim()) {
      setError('請貼上你想分享的影片連結。');
      linkRef.current?.focus();
      return;
    }
    setLinkTouched(true);
    if (!recognition.value) { linkRef.current?.focus(); return; }
    if (!title.trim()) {
      setError('請填寫影片標題。');
      titleRef.current?.focus();
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({ title: title.trim(), creator: creator.trim() || '匿名投稿', category, description: description.trim(), link: link.trim() });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'QuotaExceededError') {
        setError('目前瀏覽器的儲存空間不足，請清理網站儲存空間後再試一次。');
      } else {
        // Errors are deliberately kept generic so URLs containing access tokens are never echoed.
        setError('投稿尚未儲存成功。請確認瀏覽器允許網站儲存資料，然後重試。');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const visibleLinkError = linkTouched && recognition.error;

  return (
    <div className="link-submit-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !submittingRef.current) onClose(); }}>
      <div ref={dialogRef} className="link-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="link-submit-title" aria-describedby="link-submit-intro" tabIndex={-1}>
        <div className="link-submit-heading">
          <span className="link-submit-heading-icon"><Link2 size={23} strokeWidth={1.7} /></span>
          <div><div className="link-submit-eyebrow">SHARE A GOOD FIND</div><h2 id="link-submit-title">分享一段值得看的影片</h2><p id="link-submit-intro">貼上影片連結，為你的片庫多收藏一個好故事。</p></div>
          <button className="link-submit-close" type="button" onClick={onClose} disabled={submitting} aria-label="關閉連結投稿視窗"><X size={20} /></button>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="link-submit-body">
            <div className="link-submit-local-note"><LockKeyhole size={17} /><p><strong>瀏覽器試用</strong>投稿只保存在目前瀏覽器，經加入片庫後會出現在你的首頁。</p></div>
            <div className="link-submit-section-title"><span>01</span> 從一個連結開始</div>
            <label className="link-submit-label" htmlFor="link-submit-url">影片連結 <span>*</span></label>
            <div className={`link-submit-url-field${visibleLinkError ? ' link-submit-invalid' : ''}`}>
              <Link2 size={17} />
              <input ref={linkRef} id="link-submit-url" type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder="貼上 YouTube、Vimeo 或影片檔案網址" value={link} maxLength={4096} required disabled={submitting} aria-invalid={Boolean(visibleLinkError)} aria-describedby="link-submit-url-help" onBlur={() => setLinkTouched(true)} onChange={(event) => { setLink(event.target.value); setError(''); }} />
            </div>
            <div id="link-submit-url-help" className="link-submit-url-help" aria-live="polite">
              {visibleLinkError ? <div className="link-submit-link-error" role="alert"><AlertCircle size={14} /><span>{visibleLinkError}</span></div> : recognition.value ? <div className="link-submit-recognized"><CheckCircle2 size={14} /><span>已辨識 {recognition.value.providerLabel}<span className="link-submit-recognized-separator">·</span>{recognition.value.kind === 'direct' ? '直接影片連結' : '可嵌入播放器'}</span></div> : <span>支援 YouTube、Vimeo 與可直接播放的影片網址。</span>}
            </div>
            <div className="link-submit-section-title link-submit-details-title"><span>02</span> 補上影片的故事</div>
            <label className="link-submit-label" htmlFor="link-submit-video-title">影片標題 <span>*</span></label>
            <input ref={titleRef} className="link-submit-input" id="link-submit-video-title" value={title} onChange={(event) => { setTitle(event.target.value); setError(''); }} maxLength={80} placeholder="給這段影片一個清楚的名字" required disabled={submitting} />
            <div className="link-submit-character-count">{title.length} / 80</div>
            <div className="link-submit-field-row">
              <div><label className="link-submit-label" htmlFor="link-submit-creator">投稿者 <small>選填</small></label><input className="link-submit-input" id="link-submit-creator" value={creator} onChange={(event) => setCreator(event.target.value)} maxLength={40} placeholder="匿名投稿" disabled={submitting} /></div>
              <div><label className="link-submit-label" htmlFor="link-submit-category">影片分類 <span>*</span></label><select className="link-submit-input link-submit-category" id="link-submit-category" value={category} onChange={(event) => setCategory(event.target.value as Category)} disabled={submitting}>{submissionCategories.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
            </div>
            <label className="link-submit-label link-submit-description-label" htmlFor="link-submit-description">影片描述 <small>選填</small></label>
            <textarea className="link-submit-input link-submit-description" id="link-submit-description" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="這段影片有什麼值得分享的地方？" disabled={submitting} />
            <div className="link-submit-character-count">{description.length} / 500</div>
            {error && <div className="link-submit-error" role="alert"><AlertCircle size={17} /><span>{error}</span></div>}
            <p className="link-submit-rights-note">請使用你有權分享的影片。</p>
          </div>
          <div className="link-submit-footer"><span><ArrowUpRight size={15} /> 好影片，值得被收藏</span><div><button className="link-submit-cancel" type="button" onClick={onClose} disabled={submitting}>取消</button><button className="link-submit-primary" type="submit" disabled={submitting || !link.trim() || !title.trim()}>{submitting ? <><LoaderCircle size={16} className="link-submit-spin" /> 正在提交…</> : <><Send size={15} /> 提交連結</>}</button></div></div>
        </form>
      </div>
    </div>
  );
}
