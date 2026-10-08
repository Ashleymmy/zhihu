#!/usr/bin/env python3
"""Switch the existing Timo HTTP/TLS ingresses after candidate verification.

Run on ECS as its deployment user. Preview is the default. This only changes
Nginx routing; migrations, queue draining and worker handover are separate.
"""
import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import urllib.request


INGRESSES = (
    ("domain-ingress", "timo.clouddo.cc.conf"),
    ("domain-tls-ingress", "timo.conf"),
)
WRITE_FILE = '''set -eu
target="/config/$1"
temp="/config/.$1.release-$$"
trap 'rm -f "$temp"' EXIT
mode=$(stat -c %a "$target")
owner=$(stat -c %u:%g "$target")
umask 077
cat > "$temp"
chmod "$mode" "$temp"
chown "$owner" "$temp"
mv -f "$temp" "$target"
'''


def command(*args, input_data=None):
    result = subprocess.run(args, input=input_data, capture_output=True, timeout=45)
    if result.returncode:
        # Never print inspect output: it can contain container credentials.
        detail = result.stderr.decode("utf-8", errors="replace")[-2000:]
        raise RuntimeError(f"{args[0]} {args[1]} failed: {detail}")
    return result.stdout


def inspect(name):
    return json.loads(command("docker", "inspect", name))[0]


def replace_port(contents, old_port, new_port):
    if not re.search(r"server_name\s+timo\.clouddo\.cc\s*;", contents):
        raise ValueError("Expected Timo server_name was not found")
    ports = re.findall(r"172\.17\.0\.1:(\d+)\b", contents)
    if ports != [str(old_port)]:
        raise ValueError(f"Expected exactly one upstream on port {old_port}; found {ports}")
    return contents.replace(f"172.17.0.1:{old_port}", f"172.17.0.1:{new_port}", 1)


def verify_binding(info, port):
    if not info["State"].get("Running"):
        raise ValueError("Target application is not running")
    ports = info["NetworkSettings"].get("Ports") or {}
    bindings = ports.get("3000/tcp") or []
    if not any(p.get("HostPort") == str(port) for p in bindings):
        raise ValueError("Target port is not published by the specified application")


def read_config(container, filename):
    return command("docker", "exec", container, "cat", f"/etc/nginx/conf.d/{filename}")


def write_config(entry, contents):
    # Use the already-running ingress image, without pulling or network access.
    # Its directory bind mount allows atomic replacement while retaining metadata.
    command(
        "docker", "run", "--rm", "--interactive", "--network", "none",
        "--read-only", "--user", "0:0", "--entrypoint", "/bin/sh",
        "--mount", f"type=bind,source={entry['source']},target=/config",
        entry["image"], "-c", WRITE_FILE, "write-config", entry["filename"],
        input_data=contents,
    )


def health(port, ingress=None):
    if ingress:
        raw = command("docker", "exec", ingress, "wget", "-q", "-T", "10", "-O", "-",
                      f"http://172.17.0.1:{port}/healthz")
    else:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=10) as response:
            raw = response.read()
    if json.loads(raw) != {"status": "ok", "service": "opc"}:
        raise ValueError("Target is not a healthy OPC service")


def switch(entries, old_port, new_port, backup_dir):
    backup_dir.mkdir(parents=True, mode=0o700, exist_ok=False)
    for entry in entries:
        backup = backup_dir / f"{entry['container']}.conf"
        backup.write_bytes(entry["original"])
        backup.chmod(0o600)
    # Check all originals before replacing anything. Refuse concurrent edits.
    for entry in entries:
        if read_config(entry["container"], entry["filename"]) != entry["original"]:
            raise RuntimeError("Ingress configuration changed since preflight; no switch made")
    written = []
    try:
        for entry in entries:
            written.append(entry)
            write_config(entry, entry["replacement"])
        for entry in entries:
            command("docker", "exec", entry["container"], "nginx", "-t")
        for entry in entries:
            command("docker", "exec", entry["container"], "nginx", "-s", "reload")
    except Exception as error:
        restore_errors = []
        for entry in reversed(written):
            try:
                write_config(entry, entry["original"])
            except Exception as restore_error:
                restore_errors.append(str(restore_error))
        for entry in written:
            try:
                command("docker", "exec", entry["container"], "nginx", "-t")
                command("docker", "exec", entry["container"], "nginx", "-s", "reload")
            except Exception as restore_error:
                restore_errors.append(str(restore_error))
        if restore_errors:
            raise RuntimeError(f"Switch failed; manual ingress recovery required using {backup_dir}: "
                               + "; ".join(restore_errors)) from error
        raise RuntimeError("Switch failed; previous ingress configurations restored") from error
    receipt = {
        "fromPort": old_port, "toPort": new_port,
        "changedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "ingresses": [{"container": e["container"], "file": e["filename"],
                        "sha256": hashlib.sha256(e["replacement"]).hexdigest()} for e in entries],
    }
    (backup_dir / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-port", type=int, required=True)
    parser.add_argument("--to-port", type=int, required=True)
    parser.add_argument("--candidate-container", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-root", type=pathlib.Path,
                        default=pathlib.Path("/home/ecsdiag/zhihu-app/bluegreen"))
    args = parser.parse_args()
    if any(p < 1024 or p > 65535 for p in (args.from_port, args.to_port)) or args.from_port == args.to_port:
        parser.error("Use two distinct unprivileged ports")
    if not re.fullmatch(r"zhihu-[a-zA-Z0-9_.-]+", args.candidate_container):
        parser.error("Candidate must be a named zhihu application container")
    info = inspect(args.candidate_container)
    verify_binding(info, args.to_port)
    health(args.to_port)
    entries = []
    for container, filename in INGRESSES:
        ingress = inspect(container)
        mounts = [m for m in ingress["Mounts"] if m["Type"] == "bind" and m["Destination"] == "/etc/nginx/conf.d"]
        if len(mounts) != 1:
            raise ValueError("Ingress config directory is not the expected bind mount")
        original = read_config(container, filename)
        replacement = replace_port(original.decode("utf-8"), args.from_port, args.to_port).encode("utf-8")
        command("docker", "exec", container, "nginx", "-t")
        health(args.to_port, container)
        entries.append({"container": container, "filename": filename,
                        "source": mounts[0]["Source"], "image": ingress["Image"],
                        "original": original, "replacement": replacement})
    result = {"mode": "apply" if args.apply else "preview", "fromPort": args.from_port,
              "toPort": args.to_port, "candidate": args.candidate_container,
              "imageId": info["Image"], "ingresses": [e["container"] for e in entries]}
    if args.apply:
        stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup = args.backup_root / stamp
        result["receipt"] = switch(entries, args.from_port, args.to_port, backup)
        result["backupDirectory"] = str(backup)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Release switch stopped: {error}", file=sys.stderr)
        sys.exit(1)
