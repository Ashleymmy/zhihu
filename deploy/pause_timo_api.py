#!/usr/bin/env python3
"""Briefly drain Timo API traffic during an incompatible calculator handover.

Static pages and health checks stay available. Preview is the default; API
requests receive a retryable 503 while paused. Queue pause and worker handover
remain separate explicit operations. Resume removes only this exact marker.
"""
import argparse
import datetime as dt
import json
import pathlib
import re
import sys

import switch_timo_upstream as release


MARKER = "# timo-release-api-pause"
BLOCK = '''
    # timo-release-api-pause begin
    if ($uri ~ "^/api(?:/|$)") {
        return 503 '{"code":50300,"message":"系统正在更新，请稍后重试","data":null}';
    }
    # timo-release-api-pause end
'''


def update_config(contents, paused):
    matches = list(re.finditer(r"server_name\s+timo\.clouddo\.cc\s*;", contents))
    if len(matches) != 1:
        raise ValueError("Expected one Timo server block")
    if MARKER in contents:
        if contents.count(BLOCK) != 1 or contents.count(MARKER) != 2:
            raise ValueError("Unrecognized release pause; inspect before changing")
        return contents if paused else contents.replace(BLOCK, "", 1)
    if not paused:
        return contents
    end = matches[0].end()
    return contents[:end] + BLOCK + contents[end:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", choices=("paused", "open"), required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-root", type=pathlib.Path,
                        default=pathlib.Path("/home/ecsdiag/zhihu-app/bluegreen"))
    args = parser.parse_args()
    entries, ports = [], []
    for container, filename in release.INGRESSES:
        info = release.inspect(container)
        mounts = [m for m in info["Mounts"] if m["Type"] == "bind" and m["Destination"] == "/etc/nginx/conf.d"]
        if len(mounts) != 1:
            raise ValueError("Unexpected ingress configuration mount")
        original = release.read_config(container, filename)
        text = original.decode("utf-8")
        upstream = re.findall(r"172\.17\.0\.1:(\d+)\b", text)
        if len(upstream) != 1:
            raise ValueError("Expected one application upstream")
        ports.append(int(upstream[0]))
        release.command("docker", "exec", container, "nginx", "-t")
        entries.append({"container": container, "filename": filename, "source": mounts[0]["Source"],
                        "image": info["Image"], "original": original,
                        "replacement": update_config(text, args.state == "paused").encode("utf-8")})
    if len(set(ports)) != 1:
        raise ValueError("Ingresses must share the same application version")
    changed = any(e["original"] != e["replacement"] for e in entries)
    result = {"mode": "apply" if args.apply else "preview", "state": args.state,
              "changed": changed, "port": ports[0]}
    if args.apply and changed:
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = args.backup_root / ("api-" + args.state + "-" + stamp)
        release.switch(entries, ports[0], ports[0], backup)
        result["backupDirectory"] = str(backup)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"API handover stopped: {error}", file=sys.stderr)
        sys.exit(1)
