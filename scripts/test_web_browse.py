import unittest
from unittest.mock import Mock, patch

import web_browse
import ai_service as ai


def _dns_public(*args, **kwargs):
    return [(None, None, None, None, ("93.184.216.34", 0))]


class WebBrowseTests(unittest.TestCase):
    def test_ai_service_routes_browse_requests_to_host_browser(self):
        payload = {"type": "web_search", "query": "lunar terrain"}
        expected = {"type": "web_search", "query": "lunar terrain", "sources": []}
        with patch("web_browse.browse", return_value=expected) as browse:
            self.assertEqual(ai.handle_post("/api/ai/browse", payload), expected)
        browse.assert_called_once_with(payload)

    def test_search_normalizes_and_caps_results(self):
        rows = [
            {"title": f"Title {index}", "href": f"https://example{index}.com/page", "body": "snippet"}
            for index in range(7)
        ]
        with patch("socket.getaddrinfo", side_effect=_dns_public), patch("ddgs.ddgs.DDGS.text", return_value=rows) as search:
            result = web_browse.browse({"type": "web_search", "query": "Lunar data"})
        search.assert_called_once_with("Lunar data", max_results=5, safesearch="moderate")
        self.assertEqual(len(result["sources"]), 5)
        self.assertEqual(result["sources"][0], {"title": "Title 0", "url": "https://example0.com/page", "snippet": "snippet"})

    def test_search_empty_and_malformed_results(self):
        with patch("ddgs.ddgs.DDGS.text", return_value=[]):
            self.assertEqual(web_browse.browse({"type": "web_search", "query": "moon"})["sources"], [])
        with patch("ddgs.ddgs.DDGS.text", return_value={"unexpected": True}):
            with self.assertRaisesRegex(ValueError, "invalid result"):
                web_browse.browse({"type": "web_search", "query": "moon"})

    def test_search_failure_is_clear_and_query_is_bounded(self):
        with patch("ddgs.ddgs.DDGS.text", side_effect=TimeoutError("timeout")):
            with self.assertRaisesRegex(ValueError, "Web search failed"):
                web_browse.browse({"type": "web_search", "query": "moon"})
        with self.assertRaisesRegex(ValueError, "up to 500"):
            web_browse.browse({"type": "web_search", "query": "x" * 501})

    def test_private_and_non_http_urls_are_rejected(self):
        for url in ("file:///etc/passwd", "ftp://example.com/a", "http://127.0.0.1/", "http://[::1]/", "http://localhost/"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                web_browse._public_http_url(url)

    def test_public_hostname_resolving_to_private_ip_is_rejected(self):
        with patch("socket.getaddrinfo", return_value=[(None, None, None, None, ("10.1.2.3", 0))]):
            with self.assertRaisesRegex(ValueError, "private network"):
                web_browse._public_http_url("https://example.com/")

    def test_redirect_to_private_address_is_rejected_before_second_request(self):
        response = Mock(is_redirect=True, is_permanent_redirect=False)
        response.headers = {"Location": "http://127.0.0.1/admin"}
        session = Mock()
        session.get.return_value = response
        with patch("socket.getaddrinfo", side_effect=_dns_public), patch("requests.Session", return_value=session):
            with self.assertRaisesRegex(ValueError, "private network"):
                web_browse.browse({"type": "web_open", "url": "https://example.com/start"})
        session.get.assert_called_once()
        response.close.assert_called_once()

    def test_page_extracts_visible_text_and_caps_content(self):
        text = ("Visible research. " * 1800).encode()
        response = Mock(is_redirect=False, is_permanent_redirect=False)
        response.headers = {"Content-Type": "text/html; charset=utf-8", "Content-Length": str(len(text))}
        response.encoding = "utf-8"
        response.iter_content.return_value = [b"<html><script>ignore me</script><main><p>" + text + b"</p></main></html>"]
        session = Mock()
        session.get.return_value = response
        with patch("socket.getaddrinfo", side_effect=_dns_public), patch("requests.Session", return_value=session):
            result = web_browse.browse({"type": "web_open", "url": "https://example.com/article"})
        self.assertLessEqual(len(result["content"]), web_browse.MAX_PAGE_CHARS)
        self.assertNotIn("ignore me", result["content"])
        self.assertTrue(result["content"].startswith("Visible research."))
        response.close.assert_called_once()

    def test_oversized_page_is_rejected(self):
        response = Mock(is_redirect=False, is_permanent_redirect=False)
        response.headers = {"Content-Type": "text/plain", "Content-Length": str(web_browse.MAX_PAGE_BYTES + 1)}
        session = Mock()
        session.get.return_value = response
        with patch("socket.getaddrinfo", side_effect=_dns_public), patch("requests.Session", return_value=session):
            with self.assertRaisesRegex(ValueError, "too large"):
                web_browse.browse({"type": "web_open", "url": "https://example.com/large"})

    def test_page_fetch_has_a_total_time_limit(self):
        response = Mock(is_redirect=False, is_permanent_redirect=False)
        response.headers = {"Content-Type": "text/plain"}
        response.encoding = "utf-8"
        response.iter_content.return_value = [b"slow response"]
        session = Mock()
        session.get.return_value = response
        with patch("socket.getaddrinfo", side_effect=_dns_public), patch("requests.Session", return_value=session), patch("web_browse.time.monotonic", side_effect=[0, 0, 21]):
            with self.assertRaisesRegex(ValueError, "timed out"):
                web_browse.browse({"type": "web_open", "url": "https://example.com/slow"})
        response.close.assert_called_once()

    def test_ollama_receives_browse_actions_only_when_present_in_app_schema(self):
        ai.PROFILES["ollama"] = {"key": "", "models": [{"id": "qwen2.5:0.5b", "bytes": 1000}]}
        response = {"message": {"content": '{"reply":"Searching","actions":[]}'} }
        for enabled in (True, False):
            context = {"actions": ([{"type": "web_search"}, {"type": "web_open"}] if enabled else [])}
            with patch("ai_service.resources", return_value={"available_ram_gb": 8}), patch("ai_service.provider_json", return_value=response) as request:
                ai.chat({"provider": "ollama", "model": "qwen2.5:0.5b", "context": context, "messages": [{"role": "user", "content": "Find sources"}]})
            offered = request.call_args.kwargs["json"]["tools"][0]["function"]["parameters"]["properties"]["actions"]["items"]["properties"]["type"]["enum"]
            self.assertEqual("web_search" in offered, enabled)
            self.assertEqual("web_open" in offered, enabled)
        ai.PROFILES.pop("ollama", None)


if __name__ == "__main__":
    unittest.main()
