from __future__ import annotations

import httpx
import pytest
from playwright.sync_api import Page

BASE_URL = "http://localhost:8000"
ADMIN_USER = "testadmin"
ADMIN_PASS = "Test1234!"

_SESSION_COOKIES = ("mr_access", "mr_refresh", "mr_csrf")


def _get_session_cookies() -> list[dict]:
    r = httpx.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": ADMIN_USER, "password": ADMIN_PASS},
        timeout=10,
    )
    r.raise_for_status()
    return [
        {"name": name, "value": r.cookies[name], "url": BASE_URL}
        for name in _SESSION_COOKIES
        if name in r.cookies
    ]


@pytest.fixture(scope="session")
def _auth_token() -> list[dict]:
    return _get_session_cookies()


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {**browser_context_args, "base_url": BASE_URL}


def login(page: Page, token: list[dict] | None = None) -> None:
    if token is not None:
        page.context.add_cookies(token)
        page.add_init_script(
            f"""
            localStorage.setItem('mr_username', '{ADMIN_USER}');
            localStorage.setItem('mr_role', 'superadmin');
            """
        )
        page.goto(f"{BASE_URL}/#/users")
        page.wait_for_url(lambda url: "/login" not in url, timeout=10000)
    else:
        page.goto(f"{BASE_URL}/#/login")
        page.locator('#username').wait_for()
        page.fill('#username', ADMIN_USER)
        page.fill('#password', ADMIN_PASS)
        page.click('button[type=submit]')
        page.wait_for_url(lambda url: "/login" not in url, timeout=15000)
