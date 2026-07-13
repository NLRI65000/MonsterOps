#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


ZAP_IMAGE = "ghcr.io/zaproxy/zaproxy:stable"
DEFAULT_TARGET = "http://localhost:8000"
DEFAULT_REPORT = "tests/security/zap_report.html"


def _check_docker() -> bool:
    return shutil.which("docker") is not None


def _get_jwt_token(target: str, username: str = "testadmin", password: str = "Test1234!") -> str | None:
    try:
        import urllib.request
        import urllib.error

        data = json.dumps({"username": username, "password": password}).encode()
        req = urllib.request.Request(
            f"{target}/api/auth/login",
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            for name, value in resp.getheaders():
                if name.lower() == "set-cookie" and value.startswith("mr_access="):
                    return value.split("mr_access=", 1)[1].split(";", 1)[0]
            return None
    except Exception as exc:
        print(f"[WARN] Could not obtain JWT token: {exc}", file=sys.stderr)
        return None


def _run_baseline_scan(target: str, report_html: str, cwd: str) -> int:
    report_json = report_html.replace(".html", ".json")
    cmd = [
        "docker", "run", "--rm",
        "--network", "host",
        "-v", f"{cwd}:/zap/wrk/:rw",
        "-t", ZAP_IMAGE,
        "zap-baseline.py",
        "-t", target,
        "-r", f"/zap/wrk/{report_html}",
        "-J", f"/zap/wrk/{report_json}",
        "-I",
    ]
    print(f"[INFO] Running ZAP baseline scan against {target} …")
    print(f"[CMD]  {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd)
    return result.returncode


def _run_authenticated_scan(target: str, report_html: str, cwd: str, token: str) -> int:
    report_json = report_html.replace(".html", ".json").replace("zap_report", "zap_auth_report")
    report_html_auth = report_html.replace("zap_report", "zap_auth_report")

    openapi_url = f"{target}/api/openapi.json"

    cmd = [
        "docker", "run", "--rm",
        "--network", "host",
        "-v", f"{cwd}:/zap/wrk/:rw",
        "-e", "ZAP_AUTH_HEADER=Authorization",
        "-e", f"ZAP_AUTH_HEADER_VALUE=Bearer {token}",
        "-t", ZAP_IMAGE,
        "zap-api-scan.py",
        "-t", openapi_url,
        "-f", "openapi",
        "-r", f"/zap/wrk/{report_html_auth}",
        "-J", f"/zap/wrk/{report_json}",
        "-I",
    ]
    print(f"[INFO] Running ZAP authenticated API scan against {target} …")
    print(f"[CMD]  {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=cwd)
    return result.returncode


def _summarise(returncode: int, report_path: str) -> None:
    MEANING = {0: "PASS (no alerts)", 1: "WARN (warnings only)", 2: "FAIL (alerts found)"}
    label = MEANING.get(returncode, f"UNKNOWN ({returncode})")
    print(f"\n{'=' * 60}")
    print(f"ZAP scan result: {label}")
    if Path(report_path).exists():
        print(f"HTML report:     {report_path}")
        json_path = report_path.replace(".html", ".json")
        if Path(json_path).exists():
            print(f"JSON report:     {json_path}")
            try:
                with open(json_path) as fh:
                    data = json.load(fh)
                alerts = data.get("site", [{}])[0].get("alerts", [])
                high = [a for a in alerts if a.get("riskcode", "0") == "3"]
                medium = [a for a in alerts if a.get("riskcode", "0") == "2"]
                low = [a for a in alerts if a.get("riskcode", "0") == "1"]
                print(f"Alerts — High: {len(high)}, Medium: {len(medium)}, Low: {len(low)}")
            except Exception:
                pass
    else:
        print("[WARN] Report file not found — Docker may have failed to start.")
    print("=" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run OWASP ZAP scan against MonsterOps")
    parser.add_argument(
        "--target", default=DEFAULT_TARGET,
        help=f"Base URL of the running app (default: {DEFAULT_TARGET})",
    )
    parser.add_argument(
        "--report", default=DEFAULT_REPORT,
        help=f"Path for the HTML report (default: {DEFAULT_REPORT})",
    )
    parser.add_argument(
        "--auth-login", action="store_true",
        help="Also run an authenticated scan using the testadmin JWT token",
    )
    args = parser.parse_args()

    report_abs = str(Path(args.report).resolve())
    cwd = str(Path(__file__).parent.parent.parent.resolve())
    report_rel = str(Path(args.report))

    if not _check_docker():
        print(
            "[ERROR] Docker is not available in PATH.\n"
            "Install Docker and ensure the daemon is running, then retry:\n"
            "  https://docs.docker.com/engine/install/\n"
            "Alternatively, run ZAP directly:\n"
            "  docker pull ghcr.io/zaproxy/zaproxy:stable\n"
            f"  docker run --rm -v $(pwd):/zap/wrk/:rw -t {ZAP_IMAGE} \\\n"
            f"    zap-baseline.py -t {args.target} -r /zap/wrk/{report_rel}\n",
            file=sys.stderr,
        )
        sys.exit(3)

    Path(args.report).parent.mkdir(parents=True, exist_ok=True)

    rc = _run_baseline_scan(args.target, report_rel, cwd)
    _summarise(rc, report_abs)

    if args.auth_login:
        token = _get_jwt_token(args.target)
        if not token:
            print("[ERROR] Could not obtain JWT token — skipping authenticated scan.")
            sys.exit(1)
        auth_rc = _run_authenticated_scan(args.target, report_rel, cwd, token)
        auth_report = report_abs.replace("zap_report", "zap_auth_report")
        _summarise(auth_rc, auth_report)
        rc = max(rc, auth_rc)

    sys.exit(0 if rc <= 1 else 1)


if __name__ == "__main__":
    main()
