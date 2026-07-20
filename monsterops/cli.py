
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any



def _client(url: str, api_key: str) -> "_Client":
    return _Client(url.rstrip("/"), api_key)


class _Client:
    def __init__(self, base: str, api_key: str) -> None:
        self._base = base
        self._headers = {
            "X-API-Key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def get(self, path: str, params: dict | None = None) -> Any:
        import httpx

        r = httpx.get(f"{self._base}{path}", headers=self._headers, params=params or {}, timeout=15)
        return _check(r)

    def post(self, path: str, body: dict) -> Any:
        import httpx

        r = httpx.post(
            f"{self._base}{path}", headers=self._headers, content=json.dumps(body), timeout=15
        )
        return _check(r)

    def put(self, path: str, body: dict) -> Any:
        import httpx

        r = httpx.put(
            f"{self._base}{path}", headers=self._headers, content=json.dumps(body), timeout=15
        )
        return _check(r)

    def delete(self, path: str) -> None:
        import httpx

        r = httpx.delete(f"{self._base}{path}", headers=self._headers, timeout=15)
        if r.status_code not in (200, 204):
            _err(r)


def _check(r: Any) -> Any:
    if r.status_code >= 400:
        _err(r)
    if r.status_code == 204 or not r.content:
        return None
    return r.json()


def _err(r: Any) -> None:
    try:
        detail = r.json().get("detail", r.text)
    except Exception:
        detail = r.text
    print(f"Error {r.status_code}: {detail}", file=sys.stderr)
    sys.exit(1)


def _out(obj: Any, fmt: str) -> None:
    if fmt == "json":
        print(json.dumps(obj, indent=2, default=str))
    else:
        _table(obj)


def _table(obj: Any) -> None:
    if obj is None:
        return
    if isinstance(obj, dict):
        if "items" in obj:
            _table(obj["items"])
            total = obj.get("total")
            if total is not None:
                print(f"\n  {total} total")
            return
        rows = [obj]
    elif isinstance(obj, list):
        rows = obj
    else:
        print(obj)
        return
    if not rows:
        print("(no results)")
        return
    keys = list(rows[0].keys())
    widths = {k: max(len(k), max(len(str(r.get(k, ""))) for r in rows)) for k in keys}
    header = "  ".join(k.ljust(widths[k]) for k in keys)
    sep = "  ".join("-" * widths[k] for k in keys)
    print(header)
    print(sep)
    for r in rows:
        print("  ".join(str(r.get(k, "")).ljust(widths[k]) for k in keys))


def _get_conn(args: argparse.Namespace) -> tuple[str, str]:
    url = getattr(args, "url", None) or os.environ.get("MONSTEROPS_URL") or "http://localhost:8000"
    key = getattr(args, "api_key", None) or os.environ.get("MONSTEROPS_API_KEY") or ""
    if not key:
        print("API key required. Set --api-key or MONSTEROPS_API_KEY.", file=sys.stderr)
        sys.exit(1)
    return url, key


def _fmt(args: argparse.Namespace) -> str:
    return getattr(args, "format", "table") or "table"


def _add_conn(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--url",
        metavar="URL",
        help="Server URL (default: http://localhost:8000 or $MONSTEROPS_URL)",
    )
    p.add_argument("--api-key", dest="api_key", metavar="KEY", help="API key ($MONSTEROPS_API_KEY)")
    p.add_argument("--format", choices=["table", "json"], default="table")




def _users(sub: Any) -> None:
    p = sub.add_parser("users", help="Manage RADIUS users")
    s = p.add_subparsers(dest="users_cmd")

    pl = s.add_parser("list", help="List users")
    _add_conn(pl)
    pl.add_argument("--search", default="")
    pl.add_argument("--page", type=int, default=1)
    pl.add_argument("--size", type=int, default=50)

    pg = s.add_parser("get", help="Get a user")
    _add_conn(pg)
    pg.add_argument("username")

    pc = s.add_parser("create", help="Create a user")
    _add_conn(pc)
    pc.add_argument("username")
    pc.add_argument("--password", required=True)
    pc.add_argument(
        "--password-type",
        dest="password_type",
        default="Cleartext-Password",
        choices=[
            "Cleartext-Password",
            "MD5-Password",
            "NT-Password",
            "SHA-Password",
            "Crypt-Password",
        ],
    )
    pc.add_argument("--group", dest="groups", action="append", default=[], metavar="GROUP")
    pc.add_argument(
        "--expiration", default=None, metavar="DATE", help="Expiration date, e.g. '01 Jan 2025'"
    )
    pc.add_argument("--simultaneous-use", dest="simultaneous_use", type=int, default=None)
    pc.add_argument("--disabled", action="store_true")

    pu = s.add_parser("update", help="Update a user")
    _add_conn(pu)
    pu.add_argument("username")
    pu.add_argument("--password", default=None)
    pu.add_argument("--password-type", dest="password_type", default=None)
    pu.add_argument("--enable", dest="enabled", action="store_true", default=None)
    pu.add_argument("--disable", dest="enabled", action="store_false")
    pu.add_argument("--expiration", default=None)
    pu.add_argument("--simultaneous-use", dest="simultaneous_use", type=int, default=None)
    pu.add_argument(
        "--groups", nargs="+", default=None, metavar="GROUP", help="Replace all group memberships"
    )

    pd = s.add_parser("delete", help="Delete a user")
    _add_conn(pd)
    pd.add_argument("username")
    pd.add_argument("--yes", action="store_true")

    pe = s.add_parser("enable", help="Enable a user")
    _add_conn(pe)
    pe.add_argument("username")

    pdi = s.add_parser("disable", help="Disable a user")
    _add_conn(pdi)
    pdi.add_argument("username")


def _run_users(args: argparse.Namespace) -> None:
    url, key = _get_conn(args)
    c = _client(url, key)
    cmd = args.users_cmd

    if cmd == "list":
        data = c.get("/api/v1/users", {"search": args.search, "page": args.page, "size": args.size})
        _out(data, _fmt(args))
    elif cmd == "get":
        _out(c.get(f"/api/v1/users/{args.username}"), _fmt(args))
    elif cmd == "create":
        body: dict = {
            "username": args.username,
            "password": args.password,
            "password_type": args.password_type,
            "groups": args.groups,
            "enabled": not args.disabled,
        }
        if args.expiration:
            body["expiration"] = args.expiration
        if args.simultaneous_use is not None:
            body["simultaneous_use"] = args.simultaneous_use
        _out(c.post("/api/v1/users", body), _fmt(args))
    elif cmd == "update":
        body = {}
        if args.password is not None:
            body["password"] = args.password
        if args.password_type is not None:
            body["password_type"] = args.password_type
        if args.enabled is not None:
            body["enabled"] = args.enabled
        if args.expiration is not None:
            body["expiration"] = args.expiration
        if args.simultaneous_use is not None:
            body["simultaneous_use"] = args.simultaneous_use
        if args.groups is not None:
            body["groups"] = args.groups
        _out(c.put(f"/api/v1/users/{args.username}", body), _fmt(args))
    elif cmd == "delete":
        if not args.yes:
            ans = input(f"Delete user '{args.username}'? [y/N] ")
            if ans.lower() not in ("y", "yes"):
                sys.exit(0)
        c.delete(f"/api/v1/users/{args.username}")
        print(f"Deleted user '{args.username}'.")
    elif cmd == "enable":
        _out(c.put(f"/api/v1/users/{args.username}", {"enabled": True}), _fmt(args))
    elif cmd == "disable":
        _out(c.put(f"/api/v1/users/{args.username}", {"enabled": False}), _fmt(args))
    else:
        print("Usage: monsterops users <list|get|create|update|delete|enable|disable>")
        sys.exit(1)




def _groups(sub: Any) -> None:
    p = sub.add_parser("groups", help="Manage RADIUS groups")
    s = p.add_subparsers(dest="groups_cmd")

    pl = s.add_parser("list", help="List groups")
    _add_conn(pl)
    pl.add_argument("--search", default="")
    pl.add_argument("--page", type=int, default=1)
    pl.add_argument("--size", type=int, default=50)

    pg = s.add_parser("get", help="Get group details")
    _add_conn(pg)
    pg.add_argument("groupname")

    pc = s.add_parser("create", help="Create a group")
    _add_conn(pc)
    pc.add_argument("groupname")

    pd = s.add_parser("delete", help="Delete a group")
    _add_conn(pd)
    pd.add_argument("groupname")
    pd.add_argument("--yes", action="store_true")

    pam = s.add_parser("add-member", help="Add a user to a group")
    _add_conn(pam)
    pam.add_argument("groupname")
    pam.add_argument("username")
    pam.add_argument("--priority", type=int, default=1)

    prm = s.add_parser("remove-member", help="Remove a user from a group")
    _add_conn(prm)
    prm.add_argument("groupname")
    prm.add_argument("username")


def _run_groups(args: argparse.Namespace) -> None:
    url, key = _get_conn(args)
    c = _client(url, key)
    cmd = args.groups_cmd

    if cmd == "list":
        _out(
            c.get("/api/v1/groups", {"search": args.search, "page": args.page, "size": args.size}),
            _fmt(args),
        )
    elif cmd == "get":
        _out(c.get(f"/api/v1/groups/{args.groupname}"), _fmt(args))
    elif cmd == "create":
        _out(c.post("/api/v1/groups", {"name": args.groupname}), _fmt(args))
    elif cmd == "delete":
        if not args.yes:
            ans = input(f"Delete group '{args.groupname}'? [y/N] ")
            if ans.lower() not in ("y", "yes"):
                sys.exit(0)
        c.delete(f"/api/v1/groups/{args.groupname}")
        print(f"Deleted group '{args.groupname}'.")
    elif cmd == "add-member":
        c.post(
            f"/api/v1/groups/{args.groupname}/members",
            {"username": args.username, "priority": args.priority},
        )
        print(f"Added '{args.username}' to group '{args.groupname}'.")
    elif cmd == "remove-member":
        c.delete(f"/api/v1/groups/{args.groupname}/members/{args.username}")
        print(f"Removed '{args.username}' from group '{args.groupname}'.")
    else:
        print("Usage: monsterops groups <list|get|create|delete|add-member|remove-member>")
        sys.exit(1)




def _nas(sub: Any) -> None:
    p = sub.add_parser("nas", help="Manage NAS devices")
    s = p.add_subparsers(dest="nas_cmd")

    pl = s.add_parser("list", help="List NAS devices")
    _add_conn(pl)
    pl.add_argument("--search", default="")
    pl.add_argument("--page", type=int, default=1)
    pl.add_argument("--size", type=int, default=50)

    pg = s.add_parser("get", help="Get a NAS device")
    _add_conn(pg)
    pg.add_argument("nas_id", type=int)

    pc = s.add_parser("create", help="Create a NAS device")
    _add_conn(pc)
    pc.add_argument("--nasname", required=True, metavar="IP/FQDN")
    pc.add_argument("--secret", required=True)
    pc.add_argument("--shortname", default=None)
    pc.add_argument(
        "--type",
        default="other",
        dest="nas_type",
        choices=["other", "cisco", "mikrotik", "huawei", "juniper"],
    )
    pc.add_argument("--description", default=None)

    pu = s.add_parser("update", help="Update a NAS device")
    _add_conn(pu)
    pu.add_argument("nas_id", type=int)
    pu.add_argument("--nasname", default=None)
    pu.add_argument("--secret", default=None)
    pu.add_argument("--shortname", default=None)
    pu.add_argument("--type", default=None, dest="nas_type")
    pu.add_argument("--description", default=None)

    pd = s.add_parser("delete", help="Delete a NAS device")
    _add_conn(pd)
    pd.add_argument("nas_id", type=int)
    pd.add_argument("--yes", action="store_true")


def _run_nas(args: argparse.Namespace) -> None:
    url, key = _get_conn(args)
    c = _client(url, key)
    cmd = args.nas_cmd

    if cmd == "list":
        _out(
            c.get("/api/v1/nas", {"search": args.search, "page": args.page, "size": args.size}),
            _fmt(args),
        )
    elif cmd == "get":
        _out(c.get(f"/api/v1/nas/{args.nas_id}"), _fmt(args))
    elif cmd == "create":
        body: dict = {"nasname": args.nasname, "secret": args.secret, "type": args.nas_type}
        if args.shortname:
            body["shortname"] = args.shortname
        if args.description:
            body["description"] = args.description
        _out(c.post("/api/v1/nas", body), _fmt(args))
    elif cmd == "update":
        body = {}
        if args.nasname is not None:
            body["nasname"] = args.nasname
        if args.secret is not None:
            body["secret"] = args.secret
        if args.shortname is not None:
            body["shortname"] = args.shortname
        if args.nas_type is not None:
            body["type"] = args.nas_type
        if args.description is not None:
            body["description"] = args.description
        _out(c.put(f"/api/v1/nas/{args.nas_id}", body), _fmt(args))
    elif cmd == "delete":
        if not args.yes:
            ans = input(f"Delete NAS #{args.nas_id}? [y/N] ")
            if ans.lower() not in ("y", "yes"):
                sys.exit(0)
        c.delete(f"/api/v1/nas/{args.nas_id}")
        print(f"Deleted NAS #{args.nas_id}.")
    else:
        print("Usage: monsterops nas <list|get|create|update|delete>")
        sys.exit(1)




def _rotate(sub: Any) -> None:
    p = sub.add_parser(
        "rotate-secret-key",
        help="Re-encrypt stored NAS + directory credentials under a new MONSTEROPS_SECRET_KEY",
        description=(
            "Re-encrypts every credential stored under MONSTEROPS_SECRET_KEY (NAS "
            "Manager SSH secrets and directory bind passwords). Run it while the OLD "
            "key is still configured, then update MONSTEROPS_SECRET_KEY to the new "
            "value and restart. Operates directly on the database."
        ),
    )
    p.add_argument(
        "--old-key",
        default=None,
        help="Current key (default: MONSTEROPS_SECRET_KEY from the environment)",
    )
    p.add_argument(
        "--new-key",
        default=None,
        help="New key (default: MONSTEROPS_NEW_SECRET_KEY, else prompt)",
    )
    p.add_argument("--dry-run", action="store_true", help="Report what would change; write nothing")
    p.add_argument("--yes", action="store_true", help="Skip the confirmation prompt")


def _run_rotate(args: argparse.Namespace) -> None:
    import asyncio
    import getpass

    from monsterops.config import settings
    from monsterops.database import SessionLocal
    from monsterops.keyrotate import rotate_secret_key

    old_key = args.old_key or settings.secret_key
    new_key = args.new_key or os.environ.get("MONSTEROPS_NEW_SECRET_KEY")
    if not new_key and not args.dry_run:
        new_key = getpass.getpass("New MONSTEROPS_SECRET_KEY: ")
        if new_key != getpass.getpass("Confirm new key: "):
            print("Keys do not match.", file=sys.stderr)
            sys.exit(1)
    if not new_key:
        new_key = old_key + "-dryrun"

    if not args.yes and not args.dry_run:
        ans = input("Re-encrypt all stored NAS and directory credentials? [y/N] ")
        if ans.lower() not in ("y", "yes"):
            sys.exit(0)

    async def _do() -> Any:
        async with SessionLocal() as db:
            res = await rotate_secret_key(db, old_key, new_key, dry_run=args.dry_run)
            if not args.dry_run:
                await db.commit()
            return res

    try:
        res = asyncio.run(_do())
    except ValueError as exc:
        print(f"Rotation aborted: {exc}", file=sys.stderr)
        sys.exit(1)

    verb = "Would re-encrypt" if args.dry_run else "Re-encrypted"
    print(
        f"{verb} {res.total} credential(s): "
        f"{res.nas_manager} NAS Manager, {res.identity_sources} identity source(s)."
    )
    if not args.dry_run:
        print(
            "Now set MONSTEROPS_SECRET_KEY to the new value and restart MonsterOps "
            "(update the systemd unit / .env). The old key no longer decrypts anything."
        )




def main() -> None:
    parser = argparse.ArgumentParser(
        prog="monsterops",
        description="MonsterOps — server control and scripting interface",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Environment variables:\n"
            "  MONSTEROPS_URL      Server base URL\n"
            "  MONSTEROPS_API_KEY  API key (create at /api/apikeys)\n"
        ),
    )
    sub = parser.add_subparsers(dest="command")

    serve = sub.add_parser("serve", help="Start the MonsterOps server")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true", help="Enable auto-reload (development)")

    _users(sub)
    _groups(sub)
    _nas(sub)
    _rotate(sub)

    args = parser.parse_args()

    if args.command == "serve":
        import uvicorn

        uvicorn.run("monsterops.app:app", host=args.host, port=args.port, reload=args.reload)
    elif args.command == "users":
        _run_users(args)
    elif args.command == "groups":
        _run_groups(args)
    elif args.command == "nas":
        _run_nas(args)
    elif args.command == "rotate-secret-key":
        _run_rotate(args)
    else:
        parser.print_help()
        sys.exit(1)
