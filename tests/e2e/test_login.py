from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

from .conftest import BASE_URL, ADMIN_USER, login


@pytest.mark.e2e
def test_login_success(page: Page, _auth_token: str):
    login(page, token=_auth_token)
    assert "/login" not in page.url
    expect(page.locator("nav, aside, [role=navigation]").first).to_be_visible(timeout=5000)


@pytest.mark.e2e
def test_login_wrong_password(page: Page):
    page.goto(f"{BASE_URL}/#/login")
    page.locator('#username').wait_for()
    page.fill('#username', ADMIN_USER)
    page.fill('#password', "WrongPassword!")
    page.click('button[type=submit]')

    error = page.locator("[role=alert], .error, .alert-danger, .text-red, .text-danger").first
    expect(error).to_be_visible(timeout=5000)


@pytest.mark.e2e
def test_logout(page: Page):
    login(page)

    page.locator("a[href='#/logout']").first.click()

    page.wait_for_url(lambda url: "/login" in url, timeout=10000)
    page.locator('#username').wait_for()
    expect(page.locator('#username')).to_be_visible(timeout=5000)
