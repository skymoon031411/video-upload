#!/usr/bin/env python3
"""MUYING's small server-side library. No browser credentials or script execution."""
from __future__ import annotations

import html
import ipaddress
import json
import mimetypes
import os
import queue
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
CATEGORIES = {"城市日常", "自然風景", "旅行紀錄", "生活風格", "創意短片"}
MEDIA_EXTENSIONS = {".mp4", ".webm", ".ogv", ".ogg"}
PREVIEW_WORDS = re.compile(r"preview|trailer|teaser|sample|(^|[\W_])demo([\W_]|$)|short[\W_]*clip|試看|預告|试看|预告|サンプル|予告", re.I)
MAX_HTML = 2 * 1024 * 1024
MAX_BODY = 16 * 1024


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "invalid_request"):
        super().__init__(message)
        self.status, self.message, self.code = status, message, code


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validated_url(value: Any, resolver=socket.getaddrinfo, allowed_hosts=None, proxy_dns=False) -> str:
    """Validate every destination, including redirects; never relax this for localhost."""
    if not isinstance(value, str) or not value or len(value) > 4096 or re.search(r"[\s\x00-\x1f\x7f\\]", value):
        raise ApiError("請輸入有效的 HTTPS 網址。")
    try:
        parsed = urllib.parse.urlsplit(value)
        port = parsed.port
        host = (parsed.hostname or "").rstrip(".").lower()
    except ValueError:
        raise ApiError("網址格式不正確。") from None
    if parsed.scheme.lower() != "https" or parsed.username or parsed.password or port not in (None, 443) or not host:
        raise ApiError("只支援 HTTPS 公開網址，且不能包含帳號或密碼。")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan", ".home", ".test", ".invalid")):
        raise ApiError("不能匯入內部網路或本機網址。", code="private_destination")
    try:
        ascii_host = host.encode("idna").decode("ascii")
        if allowed_hosts is not None:
            # An administrator must explicitly trust each media/page host. No wildcards.
            if ascii_host not in allowed_hosts:
                raise ApiError("來源主機尚未加入伺服器允許清單，請設定 MUYING_ALLOWED_HOSTS 後重試。", code="host_not_allowed")
            try:
                ipaddress.ip_address(ascii_host)
                raise ApiError("伺服器允許清單只能使用公開網站網域，不能使用 IP 位址。", code="private_destination")
            except ValueError:
                pass
            if not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}", ascii_host):
                raise ApiError("來源網域格式不正確。", code="private_destination")
        addresses = resolver(ascii_host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0].split("%")[0]).is_global for item in addresses):
            raise ApiError("不能匯入內部網路或特殊網路位址。", code="private_destination")
    except ApiError:
        raise
    except OSError:
        if not (proxy_dns and allowed_hosts is not None and ascii_host in allowed_hosts):
            raise ApiError("無法解析來源網址；請確認網站可公開存取，並檢查伺服器網路設定。", code="source_unavailable") from None
        # Proxy-only cloud networks resolve approved hosts at their configured proxy.
        # This branch cannot be enabled for arbitrary destinations or direct transport.
    except (ValueError, UnicodeError):
        raise ApiError("來源網域或網路位址不正確。", code="source_unavailable") from None
    # Remove fragments; they are not part of an HTTP request. Preserve signed URLs privately.
    return urllib.parse.urlunsplit(("https", parsed.netloc, parsed.path or "/", parsed.query, ""))


class ValidatingRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, validator=validated_url):
        super().__init__()
        self.validator = validator

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return super().redirect_request(req, fp, code, msg, headers, self.validator(newurl))


class PublicFetcher:
    """urllib honors the environment's configured proxy; TLS verification stays enabled."""
    def __init__(self, allowed_hosts=None):
        configured = os.environ.get("MUYING_ALLOWED_HOSTS", "") if allowed_hosts is None else allowed_hosts
        self.allowed_hosts = {host.strip().rstrip(".").lower() for host in configured.split(",") if host.strip()} if isinstance(configured, str) else set(configured)
        self.proxy_dns = bool(urllib.request.getproxies().get("https"))
        self.opener = urllib.request.build_opener(ValidatingRedirect(self.validate))

    def validate(self, url: str):
        try:
            hostname = urllib.parse.urlsplit(url).hostname or ""
        except ValueError:
            hostname = ""
        # NO_PROXY means urllib takes direct transport, so it cannot use remote DNS.
        through_proxy = self.proxy_dns and not urllib.request.proxy_bypass(hostname)
        return validated_url(url, allowed_hosts=self.allowed_hosts, proxy_dns=through_proxy)

    def open(self, url: str):
        clean = self.validate(url)
        request = urllib.request.Request(clean, headers={"User-Agent": "MUYING/1.0 PublicVideoImporter", "Accept": "text/html,video/*,application/octet-stream;q=0.8", "Accept-Encoding": "identity"})
        try:
            return self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            error.close()
            if error.code in (401, 402, 403):
                raise ApiError("來源需要登入、付費或拒絕存取，無法直接匯入。", code="source_restricted") from None
            raise ApiError("來源網站沒有提供可讀取的影片或頁面。", code="source_unavailable") from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise ApiError("無法連線到來源網站，請稍後再試。", code="source_unavailable") from None


def media_extension(url: str) -> str:
    return Path(urllib.parse.unquote(urllib.parse.urlsplit(url).path)).suffix.lower()


def public_source(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))


def duration_value(value: Any) -> float | None:
    if isinstance(value, (int, float)) and 0 < value < 10**7:
        return float(value)
    if isinstance(value, str):
        match = re.fullmatch(r"PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?", value, re.I)
        if match:
            result = sum(float(number or 0) * factor for number, factor in zip(match.groups(), (3600, 60, 1)))
            return result or None
        try:
            numeric = float(value)
            return numeric if 0 < numeric < 10**7 else None
        except ValueError:
            pass
    return None


class VideoHTMLParser(HTMLParser):
    def __init__(self, source_url: str):
        super().__init__(convert_charrefs=True)
        self.source_url = source_url
        self.title = ""
        self.in_title = False
        self.video_context: list[dict] = []
        self.script_type = ""
        self.script_data = ""
        self.candidates: list[dict] = []
        self.video_title = ""

    def add(self, url, label="影片來源", mime="", duration=None, context=""):
        if not isinstance(url, str) or not url.strip():
            return
        joined = urllib.parse.urljoin(self.source_url, html.unescape(url.strip()))
        parsed = urllib.parse.urlsplit(joined)
        extension = media_extension(joined)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            return
        # HLS/DASH and arbitrary embedded web players require another supported method.
        if extension not in MEDIA_EXTENSIONS and mime not in ("video/mp4", "video/webm", "video/ogg"):
            return
        text = " ".join((str(label), str(context), urllib.parse.unquote(parsed.path), urllib.parse.unquote(parsed.query)))
        candidate = {"url": joined, "label": str(label or "影片來源")[:180], "mime": mime or mimetypes.guess_type(parsed.path)[0] or "video/mp4", "preview": bool(PREVIEW_WORDS.search(text))}
        seconds = duration_value(duration)
        if seconds:
            candidate["durationSeconds"] = seconds
        self.candidates.append(candidate)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "title":
            self.in_title = True
        elif tag == "video":
            context = " ".join(str(v) for k, v in attrs.items() if k in ("id", "class", "title", "aria-label", "data-type", "data-name"))
            self.video_context.append({"label": attrs.get("title") or attrs.get("aria-label") or "頁面影片", "context": context, "duration": attrs.get("data-duration")})
            self.add(attrs.get("src"), self.video_context[-1]["label"], attrs.get("type", ""), attrs.get("data-duration"), context)
        elif tag == "source" and self.video_context:
            context = self.video_context[-1]
            self.add(attrs.get("src"), attrs.get("title") or context["label"], attrs.get("type", ""), context["duration"], context["context"])
        elif tag == "meta":
            property_name = (attrs.get("property") or attrs.get("name") or "").lower()
            if property_name in ("og:video", "og:video:url", "og:video:secure_url"):
                self.add(attrs.get("content"), "頁面影片中繼資料")
            elif property_name == "og:title":
                self.video_title = attrs.get("content", "")[:300]
        elif tag == "script" and (attrs.get("type") or "").lower() == "application/ld+json":
            self.script_type = "ld+json"
            self.script_data = ""

    def handle_data(self, data):
        if self.in_title:
            self.title += data[:300]
        if self.script_type:
            self.script_data += data

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        elif tag == "video" and self.video_context:
            self.video_context.pop()
        elif tag == "script" and self.script_type:
            try:
                self.walk_json(json.loads(self.script_data))
            except (ValueError, RecursionError):
                pass
            self.script_type = ""
            self.script_data = ""

    def walk_json(self, data):
        if isinstance(data, list):
            for item in data:
                self.walk_json(item)
        elif isinstance(data, dict):
            kind = data.get("@type", "")
            if kind == "VideoObject" or isinstance(kind, list) and "VideoObject" in kind:
                name = str(data.get("name") or "VideoObject 影片")
                self.add(data.get("contentUrl"), name, "", data.get("duration"), str(data.get("description", "")))
                self.add(data.get("embedUrl"), name, "", data.get("duration"), str(data.get("description", "")))
            for value in data.values():
                if isinstance(value, (dict, list)):
                    self.walk_json(value)


def parse_page(body: str, source_url: str) -> tuple[str, list[dict]]:
    parser = VideoHTMLParser(source_url)
    try:
        parser.feed(body)
    except (ValueError, RecursionError):
        raise ApiError("來源頁面格式無法解析。", code="unsupported_page") from None
    unique: dict[str, dict] = {}
    for candidate in parser.candidates:
        if candidate["url"] in unique:
            unique[candidate["url"]]["preview"] |= candidate["preview"]
            continue
        candidate["id"] = secrets.token_urlsafe(16)
        unique[candidate["url"]] = candidate
        if len(unique) >= 30:
            break
    return html.unescape(parser.video_title or parser.title).strip()[:200], list(unique.values())


class App:
    def __init__(self, data_dir: Path | str, fetcher=None, max_bytes=1024**3, start_worker=True):
        self.data_dir = Path(data_dir).resolve()
        self.media_dir = self.data_dir / "media"
        self.temp_dir = self.data_dir / "temporary"
        self.media_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.temp_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db_path = self.data_dir / "library.sqlite3"
        self.fetcher = fetcher or PublicFetcher()
        self.max_bytes = max_bytes
        self.inspections: dict[str, dict] = {}
        self.inspection_lock = threading.Lock()
        self.import_lock = threading.Lock()
        self.queue: queue.Queue = queue.Queue(maxsize=4)
        self.stopping = threading.Event()
        self.worker_thread = None
        with self.connection() as db:
            db.executescript("""CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, title TEXT NOT NULL, source_url TEXT NOT NULL, status TEXT NOT NULL, progress REAL, downloaded_bytes INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER, error TEXT, video_id TEXT, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS videos (id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL, source_url TEXT NOT NULL, duration REAL NOT NULL, bytes INTEGER NOT NULL, date TEXT NOT NULL, filename TEXT NOT NULL, mime TEXT NOT NULL);""")
            db.execute("UPDATE jobs SET status='failed', error=?, progress=NULL WHERE status IN ('queued','downloading','verifying')", ("伺服器重新啟動，匯入中斷；請重新提交。",))
        for path in self.temp_dir.iterdir():
            if path.is_file():
                path.unlink()
        if start_worker:
            self.worker_thread = threading.Thread(target=self.worker, name="muying-import-worker", daemon=True)
            self.worker_thread.start()

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.db_path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def inspect(self, value: dict) -> dict:
        source = value.get("url")
        if not isinstance(source, str):
            raise ApiError("請輸入影片頁面或影片檔案網址。")
        source = source.strip()
        response = self.fetcher.open(source)
        try:
            final_url = response.geturl()
            mime = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
            length = response.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > self.max_bytes and mime.startswith("video/"):
                raise ApiError("影片超過伺服器允許的檔案大小。", code="file_too_large")
            if media_extension(final_url) in MEDIA_EXTENSIONS or mime in ("video/mp4", "video/webm", "video/ogg"):
                basename = urllib.parse.unquote(Path(urllib.parse.urlsplit(final_url).path).name)
                title = basename.rsplit(".", 1)[0][:200] or "匯入影片"
                candidate = {"id": secrets.token_urlsafe(16), "label": "直接影片檔", "url": final_url, "mime": mime if mime.startswith("video/") else mimetypes.guess_type(final_url)[0] or "video/mp4", "preview": bool(PREVIEW_WORDS.search(basename))}
                candidates = [candidate]
            elif mime in ("text/html", "application/xhtml+xml", ""):
                body = response.read(MAX_HTML + 1)
                if len(body) > MAX_HTML:
                    raise ApiError("來源頁面過大，無法安全分析。", code="unsupported_page")
                charset = response.headers.get_content_charset() if hasattr(response.headers, "get_content_charset") else None
                try:
                    decoded = body.decode(charset or "utf-8", errors="replace")
                except LookupError:
                    decoded = body.decode("utf-8", errors="replace")
                title, candidates = parse_page(decoded, final_url)
            else:
                title, candidates = "", []
        finally:
            response.close()
        identity = secrets.token_urlsafe(24)
        result = {"inspectionId": identity, "sourceUrl": source, "title": title or "匯入影片", "candidates": candidates}
        if not candidates:
            result["message"] = "這個頁面沒有公開的 MP4、WebM 或 Ogg 影片來源。購買頁、登入播放器、HLS／DASH 與 DRM 影片目前無法匯入。"
        elif all(candidate["preview"] for candidate in candidates):
            result["message"] = "找到的來源都標示為預告或試看片，不能當作正片匯入。"
        else:
            result["message"] = "請確認選取來源是完整正片；頁面資料與片長無法證明影片是否完整。"
        with self.inspection_lock:
            current = time.monotonic()
            self.inspections = {key: item for key, item in self.inspections.items() if item["expires"] > current}
            while len(self.inspections) >= 50:
                self.inspections.pop(next(iter(self.inspections)))
            self.inspections[identity] = {"expires": current + 900, "result": result}
        return result

    def create_import(self, value: dict) -> dict:
        if value.get("confirmedRights") is not True or value.get("confirmedFullLength") is not True:
            raise ApiError("請先確認你有保存授權，而且選取來源是完整正片。")
        title = value.get("title")
        if not isinstance(title, str) or not title.strip() or len(title) > 200:
            raise ApiError("請輸入 1 至 200 字的影片名稱。")
        category = value.get("category", "生活風格")
        if not isinstance(category, str) or category not in CATEGORIES:
            raise ApiError("請選擇有效的影片分類。")
        minimum = value.get("minDurationSeconds", 600)
        if isinstance(minimum, bool) or not isinstance(minimum, (float, int)) or not 1 <= minimum <= 24 * 3600:
            raise ApiError("最低片長必須介於 1 秒至 24 小時。")
        if not isinstance(value.get("inspectionId"), str) or not isinstance(value.get("candidateId"), str):
            raise ApiError("請先檢查網址並選取影片來源。")
        with self.inspection_lock:
            inspection = self.inspections.get(value.get("inspectionId"))
            if not inspection or inspection["expires"] <= time.monotonic():
                raise ApiError("來源檢查已過期，請重新檢查網址。", code="inspection_expired")
            result = inspection["result"]
            candidate = next((item.copy() for item in result["candidates"] if item["id"] == value.get("candidateId")), None)
        if not candidate:
            raise ApiError("找不到選取的影片來源，請重新檢查網址。")
        if candidate["preview"]:
            raise ApiError("這個來源標示為預告或試看片，無法存為正片。", code="preview_source")
        if candidate.get("durationSeconds", minimum) < minimum:
            raise ApiError("來源標示的片長小於你設定的最低片長。", code="too_short")
        identity = secrets.token_hex(16)
        job = {"id": identity, "title": title.strip(), "sourceUrl": result["sourceUrl"], "status": "queued", "progress": 0, "downloadedBytes": 0, "totalBytes": None, "createdAt": now()}
        with self.import_lock:
            if self.queue.full():
                raise ApiError("目前匯入佇列已滿，請等待正在處理的影片完成。", 429, "queue_full")
            with self.connection() as db:
                db.execute("INSERT INTO jobs(id,title,source_url,status,progress,downloaded_bytes,created_at) VALUES(?,?,?,?,?,?,?)", (identity, job["title"], job["sourceUrl"], "queued", 0, 0, job["createdAt"]))
            self.queue.put_nowait({"job": job, "candidate": candidate, "category": category, "minimum": minimum})
        return {"job": job}

    def jobs(self) -> list[dict]:
        with self.connection() as db:
            rows = db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100").fetchall()
        result = []
        for row in rows:
            item = {"id": row["id"], "title": row["title"], "sourceUrl": row["source_url"], "status": row["status"], "progress": row["progress"], "downloadedBytes": row["downloaded_bytes"], "totalBytes": row["total_bytes"], "createdAt": row["created_at"]}
            if row["error"]:
                item["error"] = row["error"]
            if row["video_id"]:
                item["videoId"] = row["video_id"]
            result.append(item)
        return result

    def library(self) -> list[dict]:
        with self.connection() as db:
            rows = db.execute("SELECT * FROM videos ORDER BY date DESC").fetchall()
        result = []
        for row in rows:
            seconds = int(row["duration"])
            duration = f"{seconds // 60}:{seconds % 60:02}" if seconds < 3600 else f"{seconds // 3600}:{seconds // 60 % 60:02}:{seconds % 60:02}"
            result.append({"id": row["id"], "title": row["title"], "category": row["category"], "description": row["description"], "creator": "網站片庫", "duration": duration, "durationSeconds": row["duration"], "bytes": row["bytes"], "views": 0, "date": row["date"], "thumbnail": "/media/link-placeholder.svg", "videoUrl": f"/api/media/{row['id']}", "serverStored": True, "sourceUrl": public_source(row["source_url"]), "providerLabel": "網站儲存"})
        return result

    def update_job(self, identity: str, **updates):
        allowed = {"status", "progress", "downloaded_bytes", "total_bytes", "error", "video_id"}
        if not updates or set(updates) - allowed:
            raise ValueError("Invalid job fields")
        with self.connection() as db:
            db.execute("UPDATE jobs SET " + ",".join(key + "=?" for key in updates) + " WHERE id=?", (*updates.values(), identity))

    def worker(self):
        while not self.stopping.is_set():
            try:
                task = self.queue.get(timeout=0.25)
            except queue.Empty:
                continue
            try:
                self.download(task)
            finally:
                self.queue.task_done()

    def verify_video(self, path: Path) -> tuple[float, str, str]:
        try:
            probe = subprocess.run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,ogg", "-max_alloc", "67108864", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,duration", "-of", "json", str(path)], capture_output=True, timeout=30, check=True)
            info = json.loads(probe.stdout)
            stream = next((item for item in info.get("streams", []) if item.get("codec_type") == "video"), None)
            if not stream:
                raise ApiError("來源檔案不含有效的影片影像。", code="invalid_media")
            duration = duration_value(info.get("format", {}).get("duration")) or duration_value(stream.get("duration"))
            if not duration:
                raise ApiError("無法確認影片片長，檔案未加入片庫。", code="invalid_media")
            container = info.get("format", {}).get("format_name", "")
            codec = stream.get("codec_name")
            audio_codecs = {item.get("codec_name") for item in info.get("streams", []) if item.get("codec_type") == "audio"}
            if "mp4" in container and codec in ("h264", "av1") and audio_codecs <= {"aac", "mp3", "opus"}:
                return duration, ".mp4", "video/mp4"
            if "webm" in container and codec in ("vp8", "vp9", "av1") and audio_codecs <= {"opus", "vorbis"}:
                return duration, ".webm", "video/webm"
            if "ogg" in container and codec == "theora" and audio_codecs <= {"vorbis", "opus"}:
                return duration, ".ogv", "video/ogg"
            raise ApiError("影片編碼無法在目前網站播放器可靠播放，請使用 H.264 MP4 或 WebM。", code="unsupported_codec")
        except ApiError:
            raise
        except FileNotFoundError:
            raise ApiError("伺服器缺少 ffprobe，請安裝 FFmpeg 後重試。", code="server_configuration") from None
        except (subprocess.SubprocessError, ValueError, OSError):
            raise ApiError("下載的檔案無法驗證為完整影片，未加入片庫。", code="invalid_media") from None

    def download(self, task: dict):
        identity = task["job"]["id"]
        temporary = self.temp_dir / f"{identity}.part"
        destination = None
        try:
            self.update_job(identity, status="downloading", progress=None)
            response = self.fetcher.open(task["candidate"]["url"])
            try:
                length = response.headers.get("Content-Length", "")
                total = int(length) if length.isdigit() else None
                if total is not None and total > self.max_bytes:
                    raise ApiError("影片超過伺服器允許的檔案大小。", code="file_too_large")
                self.update_job(identity, total_bytes=total)
                downloaded = 0
                last_update = 0.0
                with temporary.open("xb") as output:
                    while True:
                        if self.stopping.is_set():
                            raise ApiError("伺服器停止，匯入中斷；請重新提交。")
                        chunk = response.read(256 * 1024)
                        if not chunk:
                            break
                        downloaded += len(chunk)
                        if downloaded > self.max_bytes:
                            raise ApiError("影片超過伺服器允許的檔案大小。", code="file_too_large")
                        output.write(chunk)
                        if time.monotonic() - last_update >= 0.5:
                            self.update_job(identity, downloaded_bytes=downloaded, progress=min(98, downloaded / total * 98) if total else None)
                            last_update = time.monotonic()
                if total is not None and total != downloaded:
                    raise ApiError("來源傳輸不完整，影片未加入片庫。", code="incomplete_download")
            finally:
                response.close()
            self.update_job(identity, status="verifying", downloaded_bytes=downloaded, progress=99)
            seconds, extension, mime = self.verify_video(temporary)
            if seconds < task["minimum"]:
                raise ApiError(f"影片片長只有 {int(seconds)} 秒，小於設定的最低片長；檔案已移除。", code="too_short")
            video_id = secrets.token_hex(16)
            filename = video_id + extension
            destination = self.media_dir / filename
            temporary.replace(destination)
            with self.connection() as db:
                db.execute("INSERT INTO videos VALUES(?,?,?,?,?,?,?,?,?,?)", (video_id, task["job"]["title"], task["category"], "由網站伺服器保存的影片。", task["job"]["sourceUrl"], seconds, downloaded, now(), filename, mime))
                db.execute("UPDATE jobs SET status='completed', progress=100, video_id=? WHERE id=?", (video_id, identity))
        except Exception as error:
            if destination and destination.exists():
                destination.unlink()
            try:
                self.update_job(identity, status="failed", progress=None, error=error.message if isinstance(error, ApiError) else "匯入失敗，檔案未加入片庫；請確認來源後重新提交。")
            except sqlite3.Error:
                pass
        finally:
            if temporary.exists():
                temporary.unlink()

    def media(self, identity: str):
        if not re.fullmatch(r"[a-f0-9]{32}", identity):
            raise ApiError("找不到影片。", 404, "not_found")
        with self.connection() as db:
            row = db.execute("SELECT filename,mime FROM videos WHERE id=?", (identity,)).fetchone()
        if not row:
            raise ApiError("找不到影片。", 404, "not_found")
        path = self.media_dir / row["filename"]
        if not path.is_file():
            raise ApiError("影片檔案不存在，請檢查網站儲存空間。", 404, "not_found")
        return path, row["mime"]

    def stop(self):
        self.stopping.set()
        if self.worker_thread:
            self.worker_thread.join(timeout=35)


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, app: App, admin_token="", dist_dir: Path | None = None):
        super().__init__(address, Handler)
        self.app = app
        self.admin_token = admin_token
        self.dist_dir = (dist_dir or ROOT / "dist").resolve()
        self.local_mode = not bool(admin_token)


class Handler(BaseHTTPRequestHandler):
    server_version = "MUYING/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        # Avoid request paths and queries in logs, even when parsing fails.
        pass

    def send_json(self, data, status=200):
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(encoded)

    def require_admin(self):
        token = self.server.admin_token
        if token:
            supplied = self.headers.get("Authorization", "")
            if not secrets.compare_digest(supplied.encode("utf-8"), ("Bearer " + token).encode("utf-8")):
                raise ApiError("請輸入網站管理金鑰後再使用匯入功能。", 401, "authentication_required")

    def require_origin(self):
        if self.headers.get("Sec-Fetch-Site", "") == "cross-site":
            raise ApiError("這個請求不是來自網站管理介面。", 403, "origin_rejected")
        origin = self.headers.get("Origin")
        if origin:
            parsed = urllib.parse.urlsplit(origin)
            host = self.headers.get("Host", "")
            same_origin = parsed.scheme in ("http", "https") and parsed.netloc.lower() == host.lower() and not parsed.path and not parsed.query and not parsed.fragment
            dev_origin = self.server.local_mode and origin in ("http://localhost:5173", "http://127.0.0.1:5173")
            if not same_origin and not dev_origin:
                raise ApiError("管理介面的網址與伺服器不符，請從本站開啟。", 403, "origin_rejected")
        elif self.server.local_mode and self.headers.get("Sec-Fetch-Site") not in (None, "none", "same-origin"):
            raise ApiError("來源不明的瀏覽器請求已拒絕。", 403, "origin_rejected")

    def read_body(self):
        if self.headers.get("Transfer-Encoding"):
            raise ApiError("不支援這種請求格式。", 400)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ApiError("請求格式不正確。") from None
        if length <= 0 or length > MAX_BODY:
            raise ApiError("請求內容過大或為空。", 413)
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            raise ApiError("請使用 JSON 提交匯入資料。", 415)
        try:
            value = json.loads(self.rfile.read(length))
        except (ValueError, UnicodeError):
            raise ApiError("請求內容不是有效的 JSON。") from None
        if not isinstance(value, dict):
            raise ApiError("請求內容格式不正確。")
        return value

    def send_file(self, path: Path, mime: str, ranges=False):
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        if ranges and self.headers.get("Range"):
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers["Range"].strip())
            valid = bool(match and (match[1] or match[2]))
            if valid:
                if not match[1]:
                    suffix = int(match[2])
                    valid = suffix > 0
                    start = max(0, size - suffix)
                else:
                    start = int(match[1])
                    if match[2]:
                        end = min(int(match[2]), size - 1)
                    valid = start < size and start <= end
            if not valid:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "public, max-age=3600" if ranges else "no-cache")
        if ranges:
            self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        with path.open("rb") as file:
            file.seek(start)
            remaining = length
            while remaining:
                chunk = file.read(min(remaining, 256 * 1024))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            path = urllib.parse.urlsplit(self.path).path
            if path == "/api/health":
                ready = bool(shutil.which("ffprobe")) and os.access(self.server.app.data_dir, os.W_OK)
                self.send_json({"status": "ok" if ready else "unavailable", "storage": "server", "requiresAuth": not self.server.local_mode, "mode": "local" if self.server.local_mode else "authenticated", "maxBytes": self.server.app.max_bytes, "ffprobeAvailable": bool(shutil.which("ffprobe")), "storageWritable": os.access(self.server.app.data_dir, os.W_OK)}, 200 if ready else 503)
            elif path == "/api/library":
                self.send_json({"videos": self.server.app.library()})
            elif path == "/api/imports":
                self.require_admin()
                self.send_json({"jobs": self.server.app.jobs()})
            elif path.startswith("/api/media/"):
                file, mime = self.server.app.media(path[len("/api/media/"):])
                self.send_file(file, mime, ranges=True)
            elif path.startswith("/api/"):
                raise ApiError("找不到 API。", 404, "not_found")
            else:
                decoded = urllib.parse.unquote(path)
                if any(piece.startswith(".") for piece in decoded.split("/") if piece) or "\\" in decoded:
                    raise ApiError("找不到頁面。", 404, "not_found")
                file = (self.server.dist_dir / decoded.lstrip("/")).resolve()
                if not file.is_relative_to(self.server.dist_dir):
                    raise ApiError("找不到頁面。", 404, "not_found")
                if not file.is_file():
                    if Path(decoded).suffix:
                        raise ApiError("找不到檔案。", 404, "not_found")
                    file = self.server.dist_dir / "index.html"
                if not file.is_file():
                    raise ApiError("網站尚未建置，請先執行 npm run build。", 503, "build_missing")
                self.send_file(file, mimetypes.guess_type(file.name)[0] or "application/octet-stream")
        except ApiError as error:
            self.send_json({"error": error.message, "code": error.code}, error.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.send_json({"error": "伺服器讀取失敗，請稍後再試。", "code": "server_error"}, 500)

    def do_POST(self):
        try:
            self.require_admin()
            self.require_origin()
            value = self.read_body()
            path = urllib.parse.urlsplit(self.path).path
            if path == "/api/inspect":
                self.send_json(self.server.app.inspect(value))
            elif path == "/api/imports":
                self.send_json(self.server.app.create_import(value), 202)
            else:
                raise ApiError("找不到 API。", 404, "not_found")
        except ApiError as error:
            self.close_connection = True
            self.send_json({"error": error.message, "code": error.code}, error.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self.close_connection = True
            self.send_json({"error": "伺服器處理失敗，請稍後再試。", "code": "server_error"}, 500)


def main():
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "3101"))
    token = os.environ.get("MUYING_ADMIN_TOKEN", "")
    if host not in ("127.0.0.1", "localhost", "::1") and not token:
        raise SystemExit("公開部署必須設定 MUYING_ADMIN_TOKEN；本機開發可使用預設 HOST=127.0.0.1。")
    if token and (len(token) < 24 or re.search(r"[\r\n]", token)):
        raise SystemExit("MUYING_ADMIN_TOKEN 必須至少 24 字元，且不能包含換行。")
    max_bytes = int(os.environ.get("MUYING_MAX_BYTES", str(1024**3)))
    if not 1024 <= max_bytes <= 20 * 1024**3:
        raise SystemExit("MUYING_MAX_BYTES 必須介於 1024 至 21474836480。")
    if not shutil.which("ffprobe"):
        raise SystemExit("伺服器需要 ffprobe，請先安裝 FFmpeg。")
    app = App(os.environ.get("MUYING_DATA_DIR", str(ROOT / ".muying-data")), max_bytes=max_bytes)
    server = Server((host, port), app, token)
    print(f"MUYING server ready on port {server.server_port}; storage is server-side; mode={'authenticated' if token else 'local'}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.stop()


if __name__ == "__main__":
    main()
