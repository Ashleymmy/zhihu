import pathlib
import tempfile
import unittest
from unittest.mock import patch

import switch_timo_upstream as release


HTTP = "upstream zhihu_final_backend { server 172.17.0.1:3202; }\nserver { server_name timo.clouddo.cc; }"
TLS = "server { ssl_reject_handshake on; }\nserver { server_name timo.clouddo.cc; proxy_pass http://172.17.0.1:3202; }"


class SwitchTests(unittest.TestCase):
    def test_health_only_candidate_is_rejected(self):
        with patch.object(release, "command", return_value=b'{"/api/v1/modules/zhihu/workbench":404}'):
            with self.assertRaisesRegex(ValueError, "business module is unavailable"):
                release.verify_business_routes("zhihu-candidate")
        with patch.object(release, "command", return_value=b'{"/api/v1/modules/zhihu/workbench":401}'):
            release.verify_business_routes("zhihu-candidate")

    def test_preserves_tls_and_other_config(self):
        for original in (HTTP, TLS):
            updated = release.replace_port(original, 3202, 3212)
            self.assertEqual(updated.replace(":3212", ":3202"), original)

    def test_refuses_stale_or_ambiguous_target(self):
        for original in (HTTP.replace("3202", "3203"), HTTP + "172.17.0.1:3202;", HTTP.replace("timo", "other")):
            with self.assertRaises(ValueError):
                release.replace_port(original, 3202, 3212)

    def test_target_port_must_belong_to_running_container(self):
        info = {"State": {"Running": True}, "NetworkSettings": {"Ports": {"3000/tcp": [{"HostPort": "3212"}]}}}
        release.verify_binding(info, 3212)
        with self.assertRaises(ValueError):
            release.verify_binding(info, 3202)
        info["State"]["Running"] = False
        with self.assertRaises(ValueError):
            release.verify_binding(info, 3212)

    def entries(self):
        return [{"container": name, "filename": filename, "original": content.encode(),
                 "replacement": release.replace_port(content, 3202, 3212).encode()}
                for (name, filename), content in zip(release.INGRESSES, (HTTP, TLS))]

    def test_checks_concurrent_changes_before_writing(self):
        with tempfile.TemporaryDirectory() as root, patch.object(release, "read_config", return_value=b"changed"), \
                patch.object(release, "write_config") as write:
            with self.assertRaisesRegex(RuntimeError, "changed since preflight"):
                release.switch(self.entries(), 3202, 3212, pathlib.Path(root) / "backup")
            write.assert_not_called()

    def test_validation_failure_restores_both_originals(self):
        entries = self.entries()
        calls = []

        def command(*args):
            calls.append(args)
            if len(calls) == 1:
                raise RuntimeError("invalid nginx candidate")
            return b""

        with tempfile.TemporaryDirectory() as root, \
                patch.object(release, "read_config", side_effect=[e["original"] for e in entries]), \
                patch.object(release, "write_config") as write, patch.object(release, "command", side_effect=command):
            with self.assertRaisesRegex(RuntimeError, "previous ingress configurations restored"):
                release.switch(entries, 3202, 3212, pathlib.Path(root) / "backup")
            self.assertEqual(write.call_count, 4)
            self.assertEqual(write.call_args_list[2].args, (entries[1], entries[1]["original"]))
            self.assertEqual(write.call_args_list[3].args, (entries[0], entries[0]["original"]))

    def test_success_saves_receipt_and_original_files(self):
        entries = self.entries()
        with tempfile.TemporaryDirectory() as root, \
                patch.object(release, "read_config", side_effect=[e["original"] for e in entries]), \
                patch.object(release, "write_config"), patch.object(release, "command", return_value=b""):
            backup = pathlib.Path(root) / "backup"
            receipt = release.switch(entries, 3202, 3212, backup)
            self.assertEqual(receipt["toPort"], 3212)
            self.assertTrue((backup / "receipt.json").is_file())
            self.assertEqual((backup / "domain-ingress.conf").read_bytes(), entries[0]["original"])


if __name__ == "__main__":
    unittest.main()
