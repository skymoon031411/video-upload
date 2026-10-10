"""Offline integration fixtures; these do not claim external sites were downloaded."""
import io
import json
import tempfile
import threading
import time
import unittest
import socket
from unittest.mock import patch
import urllib.error
import urllib.request
from email.message import Message
from pathlib import Path

from server.app import ApiError, App, PublicFetcher, ROOT, Server, ValidatingRedirect, parse_page, validated_url


SOURCE = "https://video.example.org/main.mp4"
PAGE = "https://video.example.org/article"


class FixtureResponse(io.BytesIO):
    def __init__(self, body, url, mime, declared_length=None):
        super().__init__(body)
        self.url = url
        self.headers = Message()
        self.headers["Content-Type"] = mime
        if declared_length is not False:
            self.headers["Content-Length"] = str(len(body) if declared_length is None else declared_length)

    def geturl(self):
        return self.url


class FixtureFetcher:
    """Only in tests. Production never permits private/local HTTP sources."""
    def __init__(self, sources):
        self.sources = sources
        self.requests = []

    def open(self, url):
        self.requests.append(url)
        value = self.sources[url]
        if isinstance(value, Exception):
            raise value
        return FixtureResponse(value[0], url, value[1], value[2] if len(value) > 2 else None)


def post_data(inspection, minimum=1):
    return {"inspectionId": inspection["inspectionId"], "candidateId": inspection["candidates"][0]["id"], "title": "Original landscape fixture", "category": "自然風景", "minDurationSeconds": minimum, "confirmedRights": True, "confirmedFullLength": True}


def wait_for_job(app, identity):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        job = next(item for item in app.jobs() if item["id"] == identity)
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(0.03)
    raise AssertionError("fixture import timed out")


class DestinationChecks(unittest.TestCase):
    def resolve(self, address):
        return lambda host, port, **kwargs: [(2, 1, 6, "", (address, port))]

    def test_private_and_special_addresses_never_accepted(self):
        for address in ("127.0.0.1", "10.10.0.1", "172.16.2.1", "192.168.1.2", "169.254.169.254", "0.0.0.0", "::1", "fc00::1", "::ffff:127.0.0.1", "192.0.2.1"):
            with self.subTest(address=address), self.assertRaises(ApiError):
                validated_url("https://video.example.org/movie.mp4", resolver=self.resolve(address))
        for value in ("http://example.com/x.mp4", "https://localhost/x", "https://foo.local/x", "https://user:password@example.org/x", "https://example.org:8080/x", "https://example.org/\\x", "https://example.org/\nx", "file:///etc/passwd"):
            with self.subTest(url=value), self.assertRaises(ApiError):
                validated_url(value, resolver=self.resolve("1.1.1.1"))

    def test_public_url_retains_private_query_only_for_fetch(self):
        self.assertEqual(validated_url("https://video.example.org/movie.mp4?signature=private#play", resolver=self.resolve("1.1.1.1")), "https://video.example.org/movie.mp4?signature=private")

    def test_redirect_to_private_address_blocked(self):
        request = urllib.request.Request("https://example.com/")
        with self.assertRaises(ApiError):
            ValidatingRedirect().redirect_request(request, None, 302, "Found", Message(), "https://127.0.0.1/secret")

    def test_mixed_public_private_dns_blocked(self):
        def resolver(*args, **kwargs):
            return [(2, 1, 6, "", ("1.1.1.1", 443)), (2, 1, 6, "", ("192.168.1.1", 443))]
        with self.assertRaises(ApiError):
            validated_url("https://example.org/", resolver=resolver)

    def test_exact_allowlist_required_even_when_dns_is_public(self):
        with self.assertRaises(ApiError) as caught:
            validated_url("https://unlisted.example.org/movie.mp4", resolver=self.resolve("1.1.1.1"), allowed_hosts={"video.example.org"})
        self.assertEqual(caught.exception.code, "host_not_allowed")
        with self.assertRaises(ApiError):
            validated_url("https://1.1.1.1/movie.mp4", resolver=self.resolve("1.1.1.1"), allowed_hosts={"1.1.1.1"}, proxy_dns=True)

    def test_proxy_dns_fallback_only_for_explicit_approved_domain(self):
        def unavailable(*args, **kwargs):
            raise socket.gaierror("offline fixture")
        url = "https://video.example.org/movie.mp4"
        self.assertEqual(validated_url(url, resolver=unavailable, allowed_hosts={"video.example.org"}, proxy_dns=True), url)
        with self.assertRaises(ApiError):
            validated_url(url, resolver=unavailable, allowed_hosts={"video.example.org"}, proxy_dns=False)
        with self.assertRaises(ApiError):
            validated_url(url, resolver=unavailable, allowed_hosts=set(), proxy_dns=True)
        with self.assertRaises(ApiError):
            validated_url(url, resolver=self.resolve("127.0.0.1"), allowed_hosts={"video.example.org"}, proxy_dns=True)

    def test_redirect_must_stay_in_exact_allowlist(self):
        validator = lambda url: validated_url(url, resolver=self.resolve("1.1.1.1"), allowed_hosts={"video.example.org"})
        request = urllib.request.Request("https://video.example.org/")
        with self.assertRaises(ApiError):
            ValidatingRedirect(validator).redirect_request(request, None, 302, "Found", Message(), "https://other.example.org/movie.mp4")

    def test_no_proxy_never_enables_proxy_dns_fallback(self):
        fetcher = PublicFetcher({"video.example.org"})
        fetcher.proxy_dns = True
        with patch("server.app.urllib.request.proxy_bypass", return_value=True), patch("server.app.validated_url", return_value=SOURCE) as validator:
            fetcher.validate(SOURCE)
            self.assertFalse(validator.call_args.kwargs["proxy_dns"])


class PageExtractionChecks(unittest.TestCase):
    def test_main_video_and_preview_are_separate_candidates(self):
        title, candidates = parse_page('''<html><title>Film archive</title><video aria-label="完整影片"><source src="/files/main.mp4" type="video/mp4"></video><video class="preview"><source src="/files/preview.mp4" type="video/mp4"></video><script type="application/ld+json">{"@type":"VideoObject","name":"Feature film","duration":"PT1H2M3S","contentUrl":"https://cdn.example.org/full.webm"}</script></html>''', PAGE)
        self.assertEqual(title, "Film archive")
        self.assertEqual(len(candidates), 3)
        self.assertFalse(candidates[0]["preview"])
        self.assertTrue(candidates[1]["preview"])
        self.assertEqual(candidates[2]["durationSeconds"], 3723)

    def test_unsupported_iframe_script_hls_and_duplicates(self):
        _, candidates = parse_page('''<iframe src="https://player.example.org/"></iframe><script>window.secret = "https://cdn.example.org/main.mp4"</script><video src="https://cdn.example.org/stream.m3u8"></video><video src="/full.mp4"></video><meta property="og:video" content="/full.mp4"><meta property="og:video" content="javascript:alert(1)">''', PAGE)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0]["url"], "https://video.example.org/full.mp4")

    def test_duplicate_preview_metadata_cannot_be_upgraded(self):
        _, candidates = parse_page('<video src="/movie.mp4"></video><video title="試看" src="/movie.mp4"></video>', PAGE)
        self.assertTrue(candidates[0]["preview"])


class ImportChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.neutral_video = (ROOT / "public/media/demo.mp4").read_bytes()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.fetcher = FixtureFetcher({SOURCE: (self.neutral_video, "video/mp4")})
        self.app = App(self.directory.name, self.fetcher)

    def tearDown(self):
        self.app.stop()
        self.directory.cleanup()

    def test_actual_local_video_verified_persisted_and_query_not_public(self):
        signed_page = PAGE + "?access_token=do-not-expose"
        self.fetcher.sources[signed_page] = (f'<video src="{SOURCE}"></video>'.encode(), "text/html")
        inspection = self.app.inspect({"url": signed_page})
        job = self.app.create_import(post_data(inspection))["job"]
        finished = wait_for_job(self.app, job["id"])
        self.assertEqual(finished["status"], "completed")
        self.assertEqual(finished["downloadedBytes"], len(self.neutral_video))
        library = self.app.library()
        self.assertEqual(len(library), 1)
        self.assertEqual(library[0]["sourceUrl"], PAGE)
        self.assertTrue(library[0]["serverStored"])
        path, mime = self.app.media(library[0]["id"])
        self.assertEqual(path.read_bytes(), self.neutral_video)
        self.assertEqual(mime, "video/mp4")
        self.app.stop()
        self.app = App(self.directory.name, self.fetcher)
        self.assertEqual(self.app.library()[0]["id"], library[0]["id"])

    def test_minimum_duration_failure_removes_temporary_and_published_file(self):
        inspection = self.app.inspect({"url": SOURCE})
        finished = wait_for_job(self.app, self.app.create_import(post_data(inspection, 600))["job"]["id"])
        self.assertEqual(finished["status"], "failed")
        self.assertIn("最低片長", finished["error"])
        self.assertEqual(self.app.library(), [])
        self.assertEqual(list(self.app.temp_dir.iterdir()), [])
        self.assertEqual(list(self.app.media_dir.iterdir()), [])

    def test_nonvideo_incomplete_transfer_and_size_rejected(self):
        for body, mime, length, expected in ((b"<html>not video</html>", "video/mp4", None, "驗證"), (self.neutral_video, "video/mp4", len(self.neutral_video) + 1, "不完整"), (self.neutral_video, "video/mp4", False, "超過")):
            with self.subTest(expected=expected):
                self.fetcher.sources[SOURCE] = (body, mime, length)
                inspection = self.app.inspect({"url": SOURCE})
                if length is False:
                    self.app.max_bytes = 1024
                job = self.app.create_import(post_data(inspection))["job"]
                finished = wait_for_job(self.app, job["id"])
                self.assertEqual(finished["status"], "failed")
                self.assertIn(expected, finished["error"])
                self.assertEqual(self.app.library(), [])
                self.assertEqual(list(self.app.temp_dir.iterdir()), [])

    def test_preview_and_missing_confirmation_cannot_be_queued(self):
        preview = "https://video.example.org/sample.mp4"
        self.fetcher.sources[preview] = (self.neutral_video, "video/mp4")
        inspection = self.app.inspect({"url": preview})
        with self.assertRaisesRegex(ApiError, "試看片"):
            self.app.create_import(post_data(inspection))
        inspection = self.app.inspect({"url": SOURCE})
        value = post_data(inspection)
        value["confirmedRights"] = False
        with self.assertRaises(ApiError):
            self.app.create_import(value)
        self.assertEqual(self.app.jobs(), [])

    def test_expired_inspection_and_queue_limit_restart_cleanup(self):
        self.app.stop()
        self.app = App(self.directory.name, self.fetcher, start_worker=False)
        inspection = self.app.inspect({"url": SOURCE})
        self.app.inspections[inspection["inspectionId"]]["expires"] = 0
        with self.assertRaisesRegex(ApiError, "過期"):
            self.app.create_import(post_data(inspection))
        inspection = self.app.inspect({"url": SOURCE})
        for _ in range(4):
            self.app.create_import(post_data(inspection))
        with self.assertRaises(ApiError) as caught:
            self.app.create_import(post_data(inspection))
        self.assertEqual(caught.exception.status, 429)
        (self.app.temp_dir / "interrupted.part").write_bytes(b"partial")
        self.app = App(self.directory.name, self.fetcher, start_worker=False)
        self.assertTrue(all(job["status"] == "failed" for job in self.app.jobs()))
        self.assertEqual(list(self.app.temp_dir.iterdir()), [])

    def test_metadata_duration_too_short_and_invalid_shapes(self):
        self.fetcher.sources[PAGE] = (f'<script type="application/ld+json">{{"@type":"VideoObject","contentUrl":"{SOURCE}","duration":"PT4S"}}</script>'.encode(), "text/html")
        inspection = self.app.inspect({"url": PAGE})
        with self.assertRaisesRegex(ApiError, "最低片長"):
            self.app.create_import(post_data(inspection, 600))
        for key, value in (("category", []), ("inspectionId", []), ("minDurationSeconds", True), ("minDurationSeconds", 0)):
            data = post_data(inspection)
            data[key] = value
            with self.subTest(key=key), self.assertRaises(ApiError):
                self.app.create_import(data)

    def test_probe_does_not_follow_network_playlist(self):
        target = self.app.temp_dir / "playlist.part"
        target.write_text("#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttps://127.0.0.1/secret\n#EXT-X-ENDLIST\n")
        with self.assertRaises(ApiError):
            self.app.verify_video(target)


class APIReadChecks(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        body = (ROOT / "public/media/demo.mp4").read_bytes()
        self.body = body
        self.app = App(self.directory.name, FixtureFetcher({SOURCE: (body, "video/mp4")}))
        inspection = self.app.inspect({"url": SOURCE})
        job = self.app.create_import(post_data(inspection))["job"]
        finished = wait_for_job(self.app, job["id"])
        self.assertEqual(finished["status"], "completed")
        self.token = "fixture-admin-token-with-24-characters"
        self.server = Server(("127.0.0.1", 0), self.app, self.token)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.app.stop()
        self.directory.cleanup()

    def request(self, path, **kwargs):
        return urllib.request.urlopen(urllib.request.Request(self.origin + path, **kwargs), timeout=5)

    def test_health_public_library_and_range_playback(self):
        with self.request("/api/health") as response:
            health = json.load(response)
            self.assertEqual(health["storage"], "server")
            self.assertTrue(health["requiresAuth"])
            self.assertTrue(health["ffprobeAvailable"])
        with self.request("/api/library") as response:
            media = json.load(response)["videos"][0]["videoUrl"]
        with self.request(media, headers={"Range": "bytes=0-31"}) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.read(), self.body[:32])
            self.assertEqual(response.headers["Content-Range"], f"bytes 0-31/{len(self.body)}")
        with self.request(media, headers={"Range": "bytes=-20"}) as response:
            self.assertEqual(response.read(), self.body[-20:])
        with self.request(media, method="HEAD") as response:
            self.assertEqual(int(response.headers["Content-Length"]), len(self.body))
            self.assertEqual(response.read(), b"")
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request(media, headers={"Range": "bytes=999999999-"})
        self.assertEqual(caught.exception.code, 416)
        caught.exception.close()

    def test_admin_auth_origin_and_traversal_rejected(self):
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/imports")
        self.assertEqual(caught.exception.code, 401)
        self.assertEqual(json.load(caught.exception)["code"], "authentication_required")
        with self.request("/api/imports", headers={"Authorization": "Bearer " + self.token}) as response:
            self.assertEqual(len(json.load(response)["jobs"]), 1)
        headers = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json", "Origin": "https://other.example.org"}
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.request("/api/inspect", data=json.dumps({"url": SOURCE}).encode(), headers=headers)
        self.assertEqual(caught.exception.code, 403)
        caught.exception.close()
        for path in ("/%2e%2e/server/app.py", "/.muying-data/library.sqlite3", "/api/media/../../server/app.py"):
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError) as caught:
                self.request(path)
            self.assertEqual(caught.exception.code, 404)
            caught.exception.close()


if __name__ == "__main__":
    unittest.main()
