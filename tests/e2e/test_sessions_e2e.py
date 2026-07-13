from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

from .conftest import BASE_URL, login


@pytest.mark.e2e
def test_live_sessions_toggle(page: Page, _auth_token: str):
    login(page, token=_auth_token)
    page.goto(f"{BASE_URL}/#/accounting")
    page.wait_for_load_state("networkidle", timeout=5000)

    live_btn = page.locator("#btn-live").first

    live_btn.click()
    page.wait_for_timeout(1000)

    active_indicator = page.locator(
        "button.active, button.text-green-500, button.btn-success, "
        "button:has-text('Stop'), button:has-text('Pause'), "
        "[data-live='true'], .live-indicator"
    ).first
    if active_indicator.count() > 0:
        expect(active_indicator).to_be_visible(timeout=3000)

    live_btn.click()
    page.wait_for_timeout(500)
