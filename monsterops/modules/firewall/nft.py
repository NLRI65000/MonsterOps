
from __future__ import annotations

import asyncio
import os
import shutil

TABLE = "inet monsterops"
_NFT = "nft"


def nft_available() -> bool:
    return shutil.which(_NFT) is not None


def _wrap_priv(argv: list[str]) -> list[str]:
    if os.geteuid() == 0:
        return argv
    return ["sudo", "-n", *argv]


async def _run(
    argv: list[str], *, stdin: str | None = None, timeout: float = 15.0
) -> tuple[int, str, str]:
    cmd = _wrap_priv(argv)
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE if stdin is not None else None,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        return 127, "", f"command not found: {cmd[0]}"
    try:
        out, err = await asyncio.wait_for(
            proc.communicate(stdin.encode() if stdin is not None else None), timeout=timeout
        )
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        return 124, "", f"nft timed out after {timeout}s"
    rc = proc.returncode if proc.returncode is not None else -1
    return rc, out.decode(errors="replace"), err.decode(errors="replace")


async def check(ruleset: str) -> tuple[bool, str]:
    rc, _out, err = await _run([_NFT, "-c", "-f", "-"], stdin=ruleset)
    return rc == 0, err.strip()


async def apply(ruleset: str) -> tuple[bool, str]:
    rc, _out, err = await _run([_NFT, "-f", "-"], stdin=ruleset)
    return rc == 0, err.strip()


async def list_table() -> tuple[bool, str]:
    rc, out, err = await _run([_NFT, "list", "table", *TABLE.split()])
    if rc != 0:
        if "No such file or directory" in err or "does not exist" in err:
            return True, ""
        return False, err.strip()
    return True, out


async def list_table_json() -> tuple[bool, str]:
    rc, out, err = await _run([_NFT, "-j", "list", "table", *TABLE.split()])
    if rc != 0:
        if "No such file or directory" in err or "does not exist" in err:
            return True, ""
        return False, err.strip()
    return True, out


async def delete_table() -> tuple[bool, str]:
    rc, _out, err = await _run([_NFT, "delete", "table", *TABLE.split()])
    if rc != 0 and "No such file or directory" not in err and "does not exist" not in err:
        return False, err.strip()
    return True, ""


async def add_element(
    set_name: str, element: str, timeout_seconds: int | None = None
) -> tuple[bool, str]:
    inner = [element]
    if timeout_seconds:
        inner += ["timeout", f"{int(timeout_seconds)}s"]
    rc, _out, err = await _run([_NFT, "add", "element", *TABLE.split(), set_name, "{", *inner, "}"])
    return rc == 0, err.strip()


async def delete_element(set_name: str, element: str) -> tuple[bool, str]:
    rc, _out, err = await _run(
        [_NFT, "delete", "element", *TABLE.split(), set_name, "{", element, "}"]
    )
    return rc == 0, err.strip()
