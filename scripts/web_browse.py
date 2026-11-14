"""Host-side web search and safe, bounded page reading for LUNA AI."""
from __future__ import annotations

from html.parser import HTMLParser
import ipaddress
import socket
import time
from urllib.parse import urljoin, urlsplit

import requests
from ddgs import DDGS

MAX_QUERY_CHARS = 500
MAX_RESULTS = 5
MAX_PAGE_BYTES = 2_000_000
MAX_PAGE_CHARS = 20_000
MAX_REDIRECTS = 5
REQUEST_TIMEOUT = (3, 8)
MAX_FETCH_SECONDS = 20
_SKIP_TAGS = {"script", "style", "noscript", "svg", "canvas", "iframe", "form", "nav", "footer"}


class _VisibleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in _SKIP_TAGS:
            self.skip_depth += 1
        elif not self.skip_depth and tag in {"p", "br", "div", "li", "h1", "h2", "h3", "h4", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1
        elif not self.skip_depth and tag in {"p", "br", "div", "li", "h1", "h2", "h3", "h4", "tr"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip_depth:
            self.parts.append(data)


def _public_http_url(value: object) -> str:
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError("Enter a valid public web page URL.")
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Only public HTTP or HTTPS page URLs can be opened.")
    host = parsed.hostname.rstrip(".").lower()
    if host in {"localhost", "localhost.localdomain"} or host.endswith((".localhost", ".local", ".internal")):
        raise ValueError("Local and private network addresses cannot be opened.")
    try:
        addresses = {ipaddress.ip_address(host)}
    except ValueError:
        try:
            addresses = {
                ipaddress.ip_address(result[4][0].split("%", 1)[0])
                for result in socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
            }
        except (OSError, ValueError):
            raise ValueError("The page host could not be resolved.") from None
    if not addresses or any(not address.is_global for address in addresses):
        raise ValueError("Local and private network addresses cannot be opened.")
    return value.strip()


def _read_page(url: str) -> tuple[str, str]:
    current = url
    deadline = time.monotonic() + MAX_FETCH_SECONDS
    session = requests.Session()
    session.trust_env = False
    try:
        for redirect_count in range(MAX_REDIRECTS + 1):
            if time.monotonic() >= deadline:
                raise ValueError("Opening the page timed out.")
            current = _public_http_url(current)
            response = session.get(
                current,
                headers={"User-Agent": "LUNA-Research/1.0 (web source reader)"},
                timeout=REQUEST_TIMEOUT,
                allow_redirects=False,
                stream=True,
            )
            if response.is_redirect or response.is_permanent_redirect:
                location = response.headers.get("Location")
                response.close()
                if not location:
                    raise ValueError("The page returned an invalid redirect.")
                if redirect_count >= MAX_REDIRECTS:
                    raise ValueError("The page redirected too many times.")
                current = urljoin(current, location)
                continue
            try:
                response.raise_for_status()
                mime = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                if mime not in {"text/html", "application/xhtml+xml", "text/plain"}:
                    raise ValueError("This page format is not supported; open a regular HTML or text page.")
                length = response.headers.get("Content-Length")
                if length and int(length) > MAX_PAGE_BYTES:
                    raise ValueError("The page is too large to read safely.")
                body = bytearray()
                for chunk in response.iter_content(64 * 1024):
                    if time.monotonic() >= deadline:
                        raise ValueError("Opening the page timed out.")
                    body.extend(chunk)
                    if len(body) > MAX_PAGE_BYTES:
                        raise ValueError("The page is too large to read safely.")
                encoding = response.encoding or "utf-8"
                text = bytes(body).decode(encoding, errors="replace")
                if mime == "text/plain":
                    visible = text
                else:
                    parser = _VisibleText()
                    parser.feed(text)
                    visible = "".join(parser.parts)
                visible = "\n".join(line.strip() for line in visible.splitlines() if line.strip())
                if not visible:
                    raise ValueError("No readable text was found on this page.")
                return current, visible[:MAX_PAGE_CHARS]
            finally:
                response.close()
    finally:
        session.close()
    raise ValueError("The page could not be opened.")


def browse(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Invalid web browse request.")
    kind = payload.get("type")
    if kind == "web_search":
        query = payload.get("query")
        if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_CHARS:
            raise ValueError("Enter a search query of up to 500 characters.")
        try:
            rows = DDGS(timeout=5).text(query.strip(), max_results=MAX_RESULTS, safesearch="moderate")
        except Exception as error:
            raise ValueError(f"Web search failed: {str(error)[:220]}") from None
        if not isinstance(rows, list):
            raise ValueError("The search service returned an invalid result.")
        sources = []
        for row in rows[:MAX_RESULTS]:
            if not isinstance(row, dict):
                continue
            try:
                url = _public_http_url(row.get("href") or row.get("url"))
            except ValueError:
                continue
            title = row.get("title")
            snippet = row.get("body") or row.get("snippet")
            sources.append({
                "title": str(title or url)[:300],
                "url": url,
                "snippet": str(snippet or "")[:1200],
            })
        return {"type": kind, "query": query.strip(), "sources": sources}
    if kind == "web_open":
        url, text = _read_page(payload.get("url"))
        return {"type": kind, "url": url, "content": text}
    raise ValueError("Choose web_search or web_open.")
