from __future__ import annotations

import uuid

import pytest
from playwright.sync_api import Page, expect

from .conftest import BASE_URL, login


def _uid() -> str:
    return uuid.uuid4().hex[:8]


@pytest.mark.e2e
def test_create_and_delete_user(page: Page, _auth_token: str):
    login(page, token=_auth_token)
    page.goto(f"{BASE_URL}/#/users")
    page.wait_for_load_state("networkidle", timeout=5000)

    username = f"e2e_{_uid()}"

    page.locator("#btn-create").first.click()

    page.locator("#m-username").wait_for()
    page.locator("#m-username").fill(username)
    page.locator("#m-password").fill("TestPass1!")

    page.locator("#btn-modal-submit").click()
    page.locator(f"text=User {username} created").wait_for(timeout=10000)
    page.wait_for_load_state("networkidle", timeout=5000)

    expect(page.locator(f"tr[data-username='{username}']")).to_be_visible(timeout=5000)

    page.locator(f"tr[data-username='{username}']").click()

    page.get_by_role("button", name="Delete User").wait_for(state="visible", timeout=10000)

    page.evaluate(
        "document.querySelector('users-view').shadowRoot.getElementById('btn-delete').click()"
    )
    page.wait_for_function("() => document.querySelector('app-confirm')", timeout=5000)
    with page.expect_response(
        lambda r: f"/api/users/{username}" in r.url and r.request.method == "DELETE",
        timeout=5000,
    ):
        page.evaluate(
            "document.querySelector('app-confirm').shadowRoot.getElementById('btn-ok').click()"
        )

    expect(page.locator(f"tr[data-username='{username}']")).not_to_be_visible(timeout=5000)


@pytest.mark.e2e
def test_search_user(page: Page, _auth_token: str):
    login(page, token=_auth_token)
    page.goto(f"{BASE_URL}/#/users")
    page.wait_for_load_state("networkidle", timeout=5000)

    username = f"srch_{_uid()}"

    page.locator("#btn-create").first.click()
    page.locator("#m-username").wait_for()
    page.locator("#m-username").fill(username)
    page.locator("#m-password").fill("TestPass1!")
    page.locator("#btn-modal-submit").click()
    page.locator(f"text=User {username} created").wait_for(timeout=10000)
    page.wait_for_load_state("networkidle", timeout=5000)

    page.evaluate(
        """(username) => {
            const sr = document.querySelector('users-view').shadowRoot;
            const el = sr.getElementById('search-input');
            el.value = username;
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }""",
        username,
    )
    page.wait_for_timeout(500)
    page.wait_for_load_state("networkidle", timeout=5000)

    expect(page.locator(f"tr[data-username='{username}']")).to_be_visible(timeout=5000)
