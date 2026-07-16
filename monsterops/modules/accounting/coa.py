
from __future__ import annotations

import asyncio
import os
from concurrent.futures import ThreadPoolExecutor

from pyrad import client, dictionary, packet

_DICT_PATH = os.path.join(os.path.dirname(__file__), "radius.dict")
_DICT = dictionary.Dictionary(_DICT_PATH)
_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="coa")

_REPLY_NAMES = {
    40: "Disconnect-Request",
    41: "Disconnect-ACK",
    42: "Disconnect-NAK",
    43: "CoA-Request",
    44: "CoA-ACK",
    45: "CoA-NAK",
}
_SUCCESS_CODES = {41, 44}

_ERROR_CAUSE = {
    201: "Residual Session Context Removed",
    202: "Invalid EAP Conversation",
    203: "Unsupported Attribute",
    204: "Missing Attribute",
    205: "NAS Identification Mismatch",
    206: "Invalid Request",
    207: "Unsupported Service",
    208: "Unsupported Extension",
    401: "Administratively Prohibited",
    402: "Request Not Routable",
    403: "Session Context Not Found",
    404: "Session Context Not Removable",
    405: "Other Proxy Processing Error",
    406: "Resources Unavailable",
    407: "Request Initiated",
}


def _build_client(nas_ip: str, secret: str, timeout: int = 5) -> client.Client:
    c = client.Client(
        server=nas_ip,
        secret=secret.encode(),
        dict=_DICT,
        coaport=3799,
    )
    c.timeout = timeout
    c.retries = 1
    return c


def _error_cause_str(reply) -> str:
    try:
        cause_val = reply["Error-Cause"]
        if cause_val:
            code = cause_val[0]
            return f" (Error-Cause {code}: {_ERROR_CAUSE.get(code, 'Unknown')})"
    except Exception:  # noqa: BLE001
        pass
    return ""


def _send_disconnect_sync(
    nas_ip: str,
    secret: str,
    username: str,
    session_id: str,
    calling_station: str | None = None,
) -> dict:
    c = _build_client(nas_ip, secret)
    pkt = c.CreateCoAPacket(code=packet.DisconnectRequest)
    pkt["User-Name"] = username
    pkt["Acct-Session-Id"] = session_id
    if calling_station:
        pkt["Calling-Station-Id"] = calling_station
    try:
        reply = c.SendPacket(pkt)
        code = reply.code
        extra = _error_cause_str(reply) if code not in _SUCCESS_CODES else ""
        base = "Session disconnected" if code in _SUCCESS_CODES else "NAS rejected the disconnect"
        return {
            "success": code in _SUCCESS_CODES,
            "code": code,
            "message": f"{base}{extra}",
        }
    except client.Timeout:
        return {
            "success": False,
            "code": None,
            "message": "Timeout — NAS did not respond on port 3799",
        }
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "code": None, "message": str(exc)}


def _send_coa_sync(
    nas_ip: str,
    secret: str,
    username: str,
    session_id: str,
    attributes: dict[str, str],
    calling_station: str | None = None,
) -> dict:
    c = _build_client(nas_ip, secret)
    pkt = c.CreateCoAPacket(code=packet.CoARequest)
    pkt["User-Name"] = username
    pkt["Acct-Session-Id"] = session_id
    if calling_station:
        pkt["Calling-Station-Id"] = calling_station

    unknown = []
    for attr_name, attr_value in attributes.items():
        try:
            pkt[attr_name] = attr_value
        except Exception:  # noqa: BLE001
            unknown.append(attr_name)

    if unknown:
        return {
            "success": False,
            "code": None,
            "message": f"Unknown attribute(s): {', '.join(unknown)}",
        }

    try:
        reply = c.SendPacket(pkt)
        code = reply.code
        extra = _error_cause_str(reply) if code not in _SUCCESS_CODES else ""
        base = "CoA accepted" if code in _SUCCESS_CODES else "NAS rejected the CoA request"
        return {
            "success": code in _SUCCESS_CODES,
            "code": code,
            "message": f"{base}{extra}",
        }
    except client.Timeout:
        return {
            "success": False,
            "code": None,
            "message": "Timeout — NAS did not respond on port 3799",
        }
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "code": None, "message": str(exc)}


async def send_disconnect(
    nas_ip: str,
    secret: str,
    username: str,
    session_id: str,
    calling_station: str | None = None,
) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _EXECUTOR, _send_disconnect_sync, nas_ip, secret, username, session_id, calling_station
    )


async def send_coa(
    nas_ip: str,
    secret: str,
    username: str,
    session_id: str,
    attributes: dict[str, str],
    calling_station: str | None = None,
) -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _EXECUTOR, _send_coa_sync, nas_ip, secret, username, session_id, attributes, calling_station
    )
