import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("reporter", Path(__file__).with_name("linear_release.py"))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)
SHA = "a" * 40
OTHER = "b" * 40


class DeliveryVerificationTests(unittest.TestCase):
    def pages(self):
        return {"success": True, "result": {"canonical_deployment": {"environment": "production", "latest_stage": {"status": "success"}, "deployment_trigger": {"metadata": {"commit_hash": SHA, "branch": "main"}}, "url": "https://delivery.example.invalid"}}}

    def release(self):
        return {"draft": False, "published_at": "2026-10-07T00:00:00Z", "tag_name": "v1.2.3", "assets": [{"name": "product.mcpb", "size": 12, "state": "uploaded"}]}

    def test_pages_require_canonical_successful_production_sha(self):
        r.verify_pages_payload(self.pages(), SHA)
        for mutate in [lambda p: p.update(success=False), lambda p: p["result"]["canonical_deployment"].update(environment="preview"), lambda p: p["result"]["canonical_deployment"]["latest_stage"].update(status="failure"), lambda p: p["result"]["canonical_deployment"]["deployment_trigger"]["metadata"].update(commit_hash=OTHER)]:
            with self.subTest(mutate=mutate), self.assertRaises(r.VerificationError):
                payload = self.pages(); mutate(payload); r.verify_pages_payload(payload, SHA)

    def test_packages_require_published_tag_and_uploaded_bundle(self):
        r.verify_release_payload(self.release(), SHA, "v1.2.3", SHA)
        with self.assertRaises(r.VerificationError):
            r.verify_release_payload(self.release(), SHA, "v1.2.3", OTHER)
        for patch_value in [{"draft": True}, {"published_at": None}, {"tag_name": "v9.9.9"}, {"assets": []}, {"assets": [{"name": "product.mcpb", "size": 0, "state": "uploaded"}]}]:
            with self.subTest(patch_value=patch_value), self.assertRaises(r.VerificationError):
                release = self.release(); release.update(patch_value); r.verify_release_payload(release, SHA, "v1.2.3", SHA)

    def test_worker_requires_current_full_rollout_and_matching_source_annotation(self):
        deployments = [{"created_on": "2026-10-07", "versions": [{"version_id": "id", "percentage": 100}]}]
        version = {"id": "id", "annotations": {"workers/message": f"git:{SHA}"}}
        r.verify_worker_payload(deployments, version, SHA)
        for update in [{"id": "other"}, {"annotations": {}}, {"annotations": {"workers/message": f"git:{OTHER}"}}]:
            with self.subTest(update=update), self.assertRaises(r.VerificationError):
                changed = dict(version); changed.update(update); r.verify_worker_payload(deployments, changed, SHA)
        deployments[0]["versions"][0]["percentage"] = 50
        with self.assertRaises(r.VerificationError):
            r.verify_worker_payload(deployments, version, SHA)

    def test_checkout_rejects_wrong_repository_dirty_source_and_short_sha(self):
        config = {"repository": "oliverames/example"}
        for outputs, expected in [([SHA, "https://github.com/other/example.git"], SHA), ([SHA, "git@github.com:oliverames/example.git", " M file"], SHA), ([SHA], SHA[:8]), ([OTHER], SHA)]:
            with self.subTest(outputs=outputs), patch.object(r, "command", side_effect=outputs), self.assertRaises(r.VerificationError):
                r.validate_checkout(Path("."), config, expected)
        with patch.object(r, "command", side_effect=[SHA, "git@github.com:oliverames/example.git", ""]):
            self.assertEqual(r.validate_checkout(Path("."), config, SHA), SHA)

    def test_linear_duplicate_and_version_collision(self):
        release = {"id": "id", "version": "v1.2.3", "commitSha": SHA, "stage": {"type": "completed"}}
        data = {"data": {"recentReleasesByAccessKey": [release]}}
        with patch.object(r, "read_json", return_value=data) as read:
            self.assertTrue(r.already_reported({"version": "v1.2.3", "sha": SHA}, "synthetic-key"))
            self.assertTrue(read.call_args.kwargs["raw_token"])
            release["stage"]["type"] = "started"
            self.assertFalse(r.already_reported({"version": "v1.2.3", "sha": SHA}, "synthetic-key"))
            release["commitSha"] = OTHER
            with self.assertRaises(r.VerificationError):
                r.already_reported({"version": "v1.2.3", "sha": SHA}, "synthetic-key")

    def test_inherited_git_location_cannot_override_verified_checkout(self):
        with patch.dict(r.os.environ, {"GIT_DIR": "/unrelated/.git", "GIT_WORK_TREE": "/unrelated"}), patch.object(r.subprocess, "run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = SHA
            r.command("git", "rev-parse", "HEAD", cwd=Path("/expected"))
            self.assertNotIn("GIT_DIR", run.call_args.kwargs["env"])
            self.assertNotIn("GIT_WORK_TREE", run.call_args.kwargs["env"])

    def test_linear_api_errors_fail_closed(self):
        for response in [{"errors": [{"message": "failure"}]}, {"data": {}}]:
            with patch.object(r, "read_json", return_value=response), self.assertRaises(r.VerificationError):
                r.already_reported({"version": SHA, "sha": SHA}, "synthetic-key")

    def test_marketplace_never_reports_an_unpublished_or_superseded_checkout(self):
        config = {"mode": "marketplace", "repository": "oliverames/example", "name": "Example", "scheduled": False}
        with patch.object(r, "gh_json", return_value={"object": {"sha": OTHER}}), self.assertRaises(r.VerificationError):
            r.prepare(Path("."), config, SHA)

    def test_npm_publication_must_match_exact_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root / "package.json").write_text(json.dumps({"version": "1.2.3", "name": "@oliverames/example"}))
            config = {"mode": "github", "repository": "oliverames/example", "name": "Example", "scheduled": True, "npm": True}
            release = self.release(); release["html_url"] = "https://github.com/oliverames/example/releases/tag/v1.2.3"
            with patch.object(r, "gh_json", return_value=release), patch.object(r, "tag_commit", return_value=SHA), patch.object(r, "read_json", return_value={"gitHead": OTHER, "dist": {"integrity": "example"}}), self.assertRaises(r.VerificationError):
                r.prepare(root, config, SHA)

    def test_historical_checkout_works_without_reporting_files(self):
        import contextlib
        import io
        import subprocess
        with tempfile.TemporaryDirectory() as directory:
            temp = Path(directory)
            checkout = temp / "delivered"
            checkout.mkdir()
            def git(*args):
                return subprocess.check_output(["git", *args], cwd=checkout, text=True).strip()
            git("init", "-q", "-b", "main")
            git("remote", "add", "origin", "https://github.com/oliverames/example.git")
            (checkout / "published.txt").write_text("old delivered content")
            git("add", "published.txt")
            git("-c", "user.name=Release Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Old delivery")
            sha = git("rev-parse", "HEAD")
            self.assertFalse((checkout / ".github").exists())
            config = temp / "trusted-config.json"
            config.write_text(json.dumps({"repository": "oliverames/example", "mode": "marketplace", "name": "Example", "scheduled": False}))
            argv = ["reporter", "--root", str(checkout), "--config", str(config), "--sha", sha, "--no-history-check"]
            output = io.StringIO()
            with patch("sys.argv", argv), patch.object(r, "gh_json", return_value={"object": {"sha": sha}}), patch.dict(r.os.environ, {}, clear=True), contextlib.redirect_stdout(output):
                self.assertEqual(r.main(), 0)
            self.assertEqual(json.loads(output.getvalue())["sha"], sha)
            (checkout / "new-source.js").write_text("uncommitted code")
            with self.assertRaises(r.VerificationError):
                r.validate_checkout(checkout, {"repository": "oliverames/example"}, sha)

    def test_path_filters_skip_unrelated_changes_and_reject_nonancestor(self):
        config = {"include_paths": "site/**,src/**"}
        self.assertTrue(r.has_relevant_changes(Path("."), config, SHA, []))
        with patch.object(r, "command", side_effect=["", ""]) as command:
            self.assertFalse(r.has_relevant_changes(Path("."), config, SHA, [{"commitSha": OTHER}]))
            self.assertEqual(command.call_args.args[-2:], ("site/**", "src/**"))
        with patch.object(r, "command", side_effect=["", "src/reader.js"]):
            self.assertTrue(r.has_relevant_changes(Path("."), config, SHA, [{"commitSha": OTHER}]))
        with patch.object(r, "command", side_effect=r.VerificationError("not an ancestor")), self.assertRaises(r.VerificationError):
            r.has_relevant_changes(Path("."), config, SHA, [{"commitSha": OTHER}])

    def test_multiline_notes_do_not_become_workflow_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); output = root / "outputs"
            report = {"name": "Example", "version": SHA, "links": ["Source=https://example.invalid"], "notes": "::warning::literal notes\nsecond line", "scheduled": False, "skip": False}
            r.write_outputs(report, output, root)
            self.assertEqual((root / "linear-release-notes.md").read_text(), report["notes"])
            self.assertNotIn("::warning::", output.read_text())


if __name__ == "__main__":
    unittest.main()
