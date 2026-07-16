
from __future__ import annotations

import asyncio
import logging
from typing import AsyncGenerator

from monsterops.modules.nas_manager.models import MrNasManager

logger = logging.getLogger(__name__)

_CONNECT_TIMEOUT = 15
_CMD_TIMEOUT = 60


def _make_connect_params(nm: MrNasManager, password: str) -> dict:
    return {
        "device_type": nm.netmiko_device_type,
        "host": nm.host,
        "port": nm.port,
        "username": nm.username,
        "password": password,
        "timeout": _CONNECT_TIMEOUT,
        "session_timeout": _CMD_TIMEOUT,
        "conn_timeout": _CONNECT_TIMEOUT,
        "ssh_strict": False,
        "system_host_keys": False,
        "use_keys": False,
        "allow_agent": False,
    }


async def _run(fn, *args, **kwargs):
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


async def test_connection(nm: MrNasManager, password: str) -> tuple[bool, str]:
    try:
        from netmiko import ConnectHandler

        def _connect():
            ch = ConnectHandler(**_make_connect_params(nm, password))
            ch.disconnect()

        await _run(_connect)
        return True, ""
    except ImportError:
        return False, "netmiko is not installed — run: pip install netmiko"
    except Exception as exc:
        return False, str(exc)


async def pull_config(nm: MrNasManager, password: str) -> tuple[str, str]:
    from monsterops.modules.nas_manager.vendor_map import config_cmd_for

    cmd = config_cmd_for(nm.netmiko_device_type)
    try:
        from netmiko import ConnectHandler

        def _pull():
            ch = ConnectHandler(**_make_connect_params(nm, password))
            try:
                output = ch.send_command(cmd, read_timeout=_CMD_TIMEOUT)
            finally:
                ch.disconnect()
            return output

        output = await _run(_pull)
        return output, ""
    except ImportError:
        return "", "netmiko is not installed — run: pip install netmiko"
    except Exception as exc:
        return "", str(exc)


async def push_config(nm: MrNasManager, password: str, config_lines: list[str]) -> tuple[bool, str]:
    try:
        from netmiko import ConnectHandler

        def _push():
            ch = ConnectHandler(**_make_connect_params(nm, password))
            try:
                ch.send_config_set(config_lines, read_timeout=_CMD_TIMEOUT)
                ch.save_config()
            finally:
                ch.disconnect()

        await _run(_push)
        return True, ""
    except ImportError:
        return False, "netmiko is not installed — run: pip install netmiko"
    except Exception as exc:
        return False, str(exc)


async def run_command(nm: MrNasManager, password: str, command: str) -> tuple[str, str]:
    try:
        from netmiko import ConnectHandler

        def _run_cmd():
            ch = ConnectHandler(**_make_connect_params(nm, password))
            try:
                return ch.send_command(command, read_timeout=_CMD_TIMEOUT)
            finally:
                ch.disconnect()

        output = await _run(_run_cmd)
        return output, ""
    except ImportError:
        return "", "netmiko is not installed — run: pip install netmiko"
    except Exception as exc:
        return "", str(exc)


async def run_command_stream(
    nm: MrNasManager, password: str, command: str
) -> AsyncGenerator[str, None]:
    output, error = await run_command(nm, password, command)
    if error:
        yield f"ERROR: {error}\n"
        return
    for line in output.splitlines():
        yield line + "\n"
        await asyncio.sleep(0)
