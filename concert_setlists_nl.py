#!/usr/bin/env python3
"""Fetch recent NL concerts and save qualifying non-empty setlists to a text file.

A concert qualifies when the artist has at least one AllMusic album rated 4.5 or 5 stars.
"""

from __future__ import annotations

import argparse
import html
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

SETLIST_SEARCH_URL = "https://www.setlist.fm/search"
ALLMUSIC_SEARCH_URL = "https://www.allmusic.com/search/all/"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    )
}


@dataclass
class Concert:
    artist: str
    date: str
    venue: str
    city: str
    setlist_url: str


@dataclass
class SetlistResult:
    concert: Concert
    songs: list[str]


class Scraper:
    def __init__(self, delay_seconds: float = 0.5, timeout: int = 20) -> None:
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.delay_seconds = delay_seconds
        self.timeout = timeout
        self._artist_qualifies_cache: dict[str, bool] = {}

    def _get(self, url: str, params: dict | None = None) -> str:
        response = self.session.get(url, params=params, timeout=self.timeout)
        response.raise_for_status()
        if self.delay_seconds > 0:
            time.sleep(self.delay_seconds)
        return response.text

    def fetch_recent_nl_concerts(self, limit: int = 1000) -> list[Concert]:
        concerts: list[Concert] = []
        page = 1

        while len(concerts) < limit:
            html_text = self._get(SETLIST_SEARCH_URL, params={"country": "nl", "page": page})
            page_concerts = self._parse_setlist_search_page(html_text)
            if not page_concerts:
                break
            concerts.extend(page_concerts)
            page += 1

        return concerts[:limit]

    def _parse_setlist_search_page(self, html_text: str) -> list[Concert]:
        soup = BeautifulSoup(html_text, "html.parser")
        results: list[Concert] = []

        for item in soup.select("article.setlistPreview"):
            artist_node = item.select_one("strong a")
            date_node = item.select_one("span.dateBlock")
            venue_node = item.select_one("a[href*='/venue/']")
            city_node = item.select_one("span.pin-location")
            setlist_link = item.select_one("a[href*='/setlist/']")

            if not artist_node or not setlist_link:
                continue

            results.append(
                Concert(
                    artist=artist_node.get_text(strip=True),
                    date=date_node.get_text(" ", strip=True) if date_node else "",
                    venue=venue_node.get_text(strip=True) if venue_node else "",
                    city=city_node.get_text(" ", strip=True) if city_node else "",
                    setlist_url=urljoin("https://www.setlist.fm", setlist_link["href"]),
                )
            )

        return results

    def fetch_nonempty_setlist(self, concert: Concert) -> SetlistResult | None:
        html_text = self._get(concert.setlist_url)
        soup = BeautifulSoup(html_text, "html.parser")

        song_nodes = soup.select("div.songPart span.songLabel")
        songs = [html.unescape(node.get_text(strip=True)) for node in song_nodes if node.get_text(strip=True)]

        if not songs:
            return None
        return SetlistResult(concert=concert, songs=songs)

    def artist_has_highly_rated_album(self, artist_name: str) -> bool:
        if artist_name in self._artist_qualifies_cache:
            return self._artist_qualifies_cache[artist_name]

        search_url = urljoin(ALLMUSIC_SEARCH_URL, requests.utils.quote(artist_name))
        html_text = self._get(search_url)
        soup = BeautifulSoup(html_text, "html.parser")

        artist_row = soup.select_one("div.artist a")
        if not artist_row or "href" not in artist_row.attrs:
            self._artist_qualifies_cache[artist_name] = False
            return False

        artist_page = self._get(artist_row["href"])
        qualifies = self._artist_page_has_4_5_or_5_album(artist_page)
        self._artist_qualifies_cache[artist_name] = qualifies
        return qualifies

    def _artist_page_has_4_5_or_5_album(self, html_text: str) -> bool:
        soup = BeautifulSoup(html_text, "html.parser")

        for rating_node in soup.select(".allmusic-rating"):
            classes = " ".join(rating_node.get("class", []))
            if re.search(r"allmusic-(4_5|5)\b", classes):
                return True

            title = rating_node.get("title", "")
            if title.strip().startswith(("4.5", "5")):
                return True

        return False


def format_result(result: SetlistResult) -> str:
    c = result.concert
    header = f"{c.artist} — {c.date} — {c.venue} ({c.city})"
    hyperlink = f"Full setlist: {c.setlist_url}"
    songs = "\n".join(f"  - {song}" for song in result.songs)
    return f"{header}\n{hyperlink}\n{songs}"


def iter_qualifying_setlists(scraper: Scraper, limit: int, progress: bool = False) -> Iterable[SetlistResult]:
    concerts = scraper.fetch_recent_nl_concerts(limit=limit)
    if progress:
        print(f"Fetched {len(concerts)} concerts from setlist.fm", file=sys.stderr)
    for idx, concert in enumerate(concerts, start=1):
        if progress and idx % 25 == 0:
            print(f"Scanned {idx}/{len(concerts)} concerts...", file=sys.stderr)
        if not scraper.artist_has_highly_rated_album(concert.artist):
            continue
        result = scraper.fetch_nonempty_setlist(concert)
        if result is not None:
            yield result


def write_results(results: list[SetlistResult], output_path: Path, note: str | None = None) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        handle.write("Netherlands concerts with qualifying artists and non-empty setlists\n")
        handle.write("=" * 70 + "\n\n")
        for index, result in enumerate(results, start=1):
            handle.write(f"{index}. {format_result(result)}\n\n")
        handle.write(f"Total matching non-empty setlists: {len(results)}\n")
        if note:
            handle.write(f"Note: {note}\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=1000, help="Number of recent NL concerts to scan")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between HTTP requests in seconds")
    parser.add_argument("--max-results", type=int, default=0, help="Stop after collecting this many matches (0 = no cap)")
    parser.add_argument("--output", default="nl_qualifying_setlists.txt", help="Output text file path")
    parser.add_argument("--quiet", action="store_true", help="Suppress progress messages")
    parser.add_argument("--wait-on-exit", action="store_true", help="Wait for Enter before closing (useful when double-clicking on Windows)")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    scraper = Scraper(delay_seconds=args.delay)

    matches: list[SetlistResult] = []
    output_path = Path(args.output)

    try:
        for result in iter_qualifying_setlists(scraper, limit=args.limit, progress=not args.quiet):
            matches.append(result)
            if args.max_results > 0 and len(matches) >= args.max_results:
                break

        note = None
        if not matches:
            note = (
                "No qualifying setlists were found. This can happen if the upstream HTML layout "
                "changed or if no recent matches satisfy the rating filter."
            )
        write_results(matches, output_path, note=note)
        print(f"Wrote {len(matches)} matching setlists to {output_path.resolve()}")
        if args.wait_on_exit or os.name == "nt":
            input("Press Enter to exit...")
        return 0
    except Exception as exc:
        write_results(
            [],
            output_path,
            note=(
                "Run failed before completion: "
                f"{type(exc).__name__}: {exc}"
            ),
        )
        print(
            f"Run failed ({type(exc).__name__}: {exc}). Details written to {output_path.resolve()}",
            file=sys.stderr,
        )
        if args.wait_on_exit or os.name == "nt":
            input("Press Enter to exit...")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
