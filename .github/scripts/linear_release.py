#!/usr/bin/env python3
"""Verify an existing delivery before reporting it to Linear. Never deploys."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


class VerificationError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def command(*args, cwd=None, timeout=120):
    env = os.environ.copy()
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"):
        env.pop(name, None)
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        # Do not copy command output: upstream responses can contain credentials.
        raise VerificationError(f"{args[0]} failed (exit {result.returncode}); no release was reported")
    return result.stdout.strip()


def read_json(url, token=None, data=None, raw_token=False):
    headers = {"Accept": "application/json", "User-Agent": "Ames-Linear-Release/1"}
    if token:
        headers["Authorization"] = token if raw_token else f"Bearer {token}"
    if data is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(data).encode()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=30) as response:
            return json.load(response)
    except (urllib.error.URLError, ValueError) as exc:
        raise VerificationError("Delivery verification API failed; no release was reported") from exc


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_url(url, expected_status, expected_body=None):
    request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "Ames-Linear-Release/1"})
    try:
        response = urllib.request.build_opener(NoRedirect()).open(request, timeout=30)
    except urllib.error.HTTPError as exc:
        response = exc
    except urllib.error.URLError as exc:
        raise VerificationError("Receiving site is unreachable; no release was reported") from exc
    with response:
        require(response.code == expected_status, f"Receiving site returned {response.code}, expected {expected_status}")
        if expected_body is not None:
            require(response.read(4096).decode().strip() == expected_body, "Receiving site source revision does not match")


def verify_pages_payload(payload, sha):
    require(payload.get("success") is True, "Cloudflare rejected the project read")
    deployment = (payload.get("result") or {}).get("canonical_deployment") or {}
    require(deployment.get("environment") == "production", "No canonical production deployment")
    require(deployment.get("latest_stage", {}).get("status") == "success", "Production deployment is not successful")
    metadata = deployment.get("deployment_trigger", {}).get("metadata", {})
    require(metadata.get("commit_hash") == sha, "Canonical production deployment is a different source revision")
    require(metadata.get("branch") == "main", "Canonical production deployment is not from main")
    return deployment


def verify_release_payload(release, sha, tag, tag_sha):
    require(release.get("draft") is False and release.get("published_at"), "GitHub release has not been published")
    require(release.get("tag_name") == tag, "GitHub release tag does not match")
    require(tag_sha == sha, "Published tag points at a different source revision")
    assets = [a for a in release.get("assets", []) if a.get("name", "").endswith(".mcpb")]
    require(assets and all(a.get("state") == "uploaded" and a.get("size", 0) > 0 for a in assets), "Published MCPB artifact is missing or incomplete")


def verify_worker_payload(deployments, version, sha):
    # Wrangler's JSON output is either the result object or the deployments array.
    items = deployments.get("deployments", []) if isinstance(deployments, dict) else deployments
    require(isinstance(items, list) and items, "No Worker deployments available")
    latest = max(items, key=lambda item: item.get("created_on", ""))
    versions = latest.get("versions", [])
    require(len(versions) == 1 and versions[0].get("percentage") == 100, "Worker does not serve one fully deployed version")
    require(versions[0].get("version_id") == version.get("id"), "Worker version does not match active deployment")
    annotation = version.get("annotations", {}).get("workers/message")
    require(annotation == f"git:{sha}", "Active Worker version has no matching verified source revision")
    return latest


def repo_identity(remote):
    return re.sub(r"\.git$", "", remote.removeprefix("git@github.com:").removeprefix("https://github.com/"))


def validate_checkout(root, config, expected_sha):
    sha = command("git", "rev-parse", "HEAD", cwd=root)
    require(re.fullmatch(r"[0-9a-f]{40}", expected_sha or "") is not None, "Supply the exact 40-character delivered commit SHA")
    require(sha == expected_sha, "Checkout does not match the delivered commit")
    require(repo_identity(command("git", "remote", "get-url", "origin", cwd=root)) == config["repository"], "Wrong repository checkout")
    require(not command("git", "status", "--porcelain", "--untracked-files=normal", cwd=root), "Checkout contains modified or untracked source files")
    return sha


def gh_json(endpoint):
    return json.loads(command("gh", "api", endpoint))


def tag_commit(repository, tag):
    obj = gh_json(f"repos/{repository}/git/ref/tags/{urllib.parse.quote(tag, safe='')}")["object"]
    for _ in range(5):
        if obj["type"] == "commit":
            return obj["sha"]
        require(obj["type"] == "tag", "Unsupported release tag target")
        obj = gh_json(f"repos/{repository}/git/tags/{obj['sha']}")["object"]
    raise VerificationError("Release tag nesting is ambiguous")


def prepare(root, config, sha):
    mode = config["mode"]
    repository = config["repository"]
    version = sha
    links = [f"Source=https://github.com/{repository}/commit/{sha}"]
    notes = ""
    if mode == "pages":
        account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
        token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
        require(account and token, "Cloudflare read credentials are required to verify delivery")
        payload = read_json(f"https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{config['project']}", token)
        deployment = verify_pages_payload(payload, sha)
        links.append(f"Deployment={deployment['url']}")
    elif mode == "github":
        package = json.loads((root / "package.json").read_text())
        version = "v" + package["version"]
        require(re.fullmatch(r"v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?", version), "Package version is not a supported release version")
        release = gh_json(f"repos/{repository}/releases/tags/{urllib.parse.quote(version, safe='')}")
        verify_release_payload(release, sha, version, tag_commit(repository, version))
        links.append(f"GitHub release={release['html_url']}")
        notes = release.get("body") or ""
        if config.get("npm"):
            package_name = urllib.parse.quote(package["name"], safe="")
            published = read_json(f"https://registry.npmjs.org/{package_name}/{package['version']}")
            require(published.get("gitHead") == sha, "npm package was not published from this source revision")
            require(published.get("dist", {}).get("integrity"), "npm package integrity metadata is missing")
            links.append(f"npm=https://www.npmjs.com/package/{package['name']}/v/{package['version']}")
    elif mode == "marketplace":
        remote_sha = gh_json(f"repos/{repository}/git/ref/heads/main")["object"]["sha"]
        require(remote_sha == sha, "Marketplace main has advanced; verify and report its current commit instead")
        links.append(f"Marketplace=https://github.com/{repository}")
    elif mode == "worker":
        cwd = root / "app"
        deployments = json.loads(command("npx", "--no-install", "wrangler", "deployments", "list", "--json", cwd=cwd))
        items = deployments.get("deployments", []) if isinstance(deployments, dict) else deployments
        require(items, "No Worker deployments available")
        latest = max(items, key=lambda item: item.get("created_on", ""))
        versions = latest.get("versions", [])
        require(len(versions) == 1 and versions[0].get("percentage") == 100, "Partial Worker rollout cannot be reported as delivered")
        deployed_version = json.loads(command("npx", "--no-install", "wrangler", "versions", "view", versions[0]["version_id"], "--json", cwd=cwd))
        verify_worker_payload(deployments, deployed_version, sha)
    else:
        raise VerificationError("Unsupported delivery mode")
    for check in config.get("checks", []):
        verify_url(check["url"], check["status"], sha if check.get("revision") else None)
        links.append(f"Receiving site={check['url']}")
    run_id = os.environ.get("GITHUB_RUN_ID")
    if run_id:
        links.append(f"Workflow=https://github.com/{repository}/actions/runs/{run_id}")
    return {"name": f"{config['name']} {version}", "version": version, "sha": sha,
            "links": links, "notes": notes, "scheduled": config["scheduled"]}


def release_history(key):
    response = read_json("https://api.linear.app/graphql", key, {
        "query": "query { recentReleasesByAccessKey(limit: 20) { id version commitSha stage { type } } }"}, raw_token=True)
    require(not response.get("errors"), "Linear could not verify previous reports")
    require("recentReleasesByAccessKey" in response.get("data", {}), "Linear returned no release history")
    return response["data"]["recentReleasesByAccessKey"]


def already_reported(report, key, history=None):
    for release in release_history(key) if history is None else history:
        if release.get("version") == report["version"]:
            require(release.get("commitSha") == report["sha"], "This release version already belongs to another commit")
            return (release.get("stage") or {}).get("type") == "completed"
    return False


def has_relevant_changes(root, config, sha, history):
    paths = [path for path in config.get("include_paths", "").split(",") if path]
    if not paths or not history:
        return True
    base = history[0].get("commitSha", "")
    require(re.fullmatch(r"[0-9a-f]{40}", base or ""), "Previous release has no usable source revision")
    # Fail closed for a rollback or unrelated history instead of attributing its diff.
    command("git", "merge-base", "--is-ancestor", base, sha, cwd=root)
    return bool(command("git", "diff", "--name-only", base, sha, "--", *paths, cwd=root))


def write_outputs(report, path, temp):
    notes_path = temp / "linear-release-notes.md"
    notes_path.write_text(report["notes"])
    values = {"name": report["name"], "version": report["version"], "links": "\n".join(report["links"]),
              "notes": str(notes_path), "scheduled": str(report["scheduled"]).lower(), "skip": str(report["skip"]).lower(),
              "baseline": str(report.get("baseline", False)).lower(), "reason": report.get("reason", "")}
    with path.open("a") as output:
        for name, value in values.items():
            delimiter = "LINEAR_" + uuid.uuid4().hex
            output.write(f"{name}<<{delimiter}\n{value}\n{delimiter}\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--root", type=Path, help="Delivered checkout, separate from reporter tooling")
    parser.add_argument("--config", type=Path, help="Trusted repository reporting configuration")
    parser.add_argument("--expect-reported", action="store_true", help="Verify the completed Linear record only")
    parser.add_argument("--no-history-check", action="store_true", help="Verify delivery only; do not contact Linear")
    args = parser.parse_args()
    root = (args.root or Path(__file__).resolve().parents[2]).resolve()
    config = json.loads((args.config or root / ".github/linear-release.json").read_text())
    sha = validate_checkout(root, config, args.sha)
    key = os.environ.get("LINEAR_ACCESS_KEY", "")
    if args.expect_reported:
        version = "v" + json.loads((root / "package.json").read_text())["version"] if config["mode"] == "github" else sha
        require(key, "Linear pipeline access key is unavailable")
        require(already_reported({"version": version, "sha": sha}, key), "Completed release was not verified in Linear")
        print("Linear readback confirms the delivered version and commit are completed.")
        return 0
    report = prepare(root, config, sha)
    require(key or args.no_history_check, "Linear pipeline access key is unavailable")
    history = [] if args.no_history_check else release_history(key)
    duplicate = False if args.no_history_check else already_reported(report, key, history)
    irrelevant = not duplicate and not has_relevant_changes(root, config, sha, history)
    report["skip"] = duplicate or irrelevant
    report["baseline"] = not history
    report["reason"] = "already completed" if duplicate else "no relevant source changes" if irrelevant else ""
    if os.environ.get("GITHUB_OUTPUT"):
        write_outputs(report, Path(os.environ["GITHUB_OUTPUT"]), Path(os.environ["RUNNER_TEMP"]))
    else:
        print(json.dumps(report))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (VerificationError, subprocess.TimeoutExpired) as exc:
        print(f"Release verification stopped: {exc}", file=sys.stderr)
        raise SystemExit(1)
