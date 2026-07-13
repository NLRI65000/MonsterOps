from __future__ import annotations

import pytest
from playwright.sync_api import Page

from .conftest import BASE_URL, login


_NAV_LINKS: list[tuple[str, str]] = [
    ("Users", "user"),
    ("NAS", "nas"),
    ("Accounting", "accounting"),
    ("Health", "health"),
]


@pytest.mark.e2e
def test_sidebar_links(page: Page, _auth_token: str):
    login(page, token=_auth_token)

    for link_text, _ in _NAV_LINKS:
        nav_link = page.locator(f"nav a:has-text('{link_text}'), aside a:has-text('{link_text}')").first
        if nav_link.count() == 0:
            continue
        nav_link.click()
        page.wait_for_load_state("networkidle", timeout=5000)

        content = page.content()
        assert "No page yet" not in content
        assert "404" not in page.title()


@pytest.mark.e2e
def test_router_direct_url(page: Page, _auth_token: str):
    login(page, token=_auth_token)

    page.goto(f"{BASE_URL}/#/users")
    page.wait_for_load_state("networkidle", timeout=5000)

    page_hash = page.evaluate("window.location.hash")
    assert "users" in page_hash.lower()

    assert "No page yet" not in page.content()
