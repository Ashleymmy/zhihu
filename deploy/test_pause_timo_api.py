import unittest

import pause_timo_api as pause


class PauseTests(unittest.TestCase):
    def test_preserves_other_hosts_and_exactly_restores_original(self):
        original = ('server { server_name other.example; return 200; }\n'
                    'server { server_name timo.clouddo.cc; location / { proxy_pass http://172.17.0.1:3202; } }')
        updated = pause.update_config(original, True)
        self.assertEqual(updated.count(pause.BLOCK), 1)
        self.assertEqual(pause.update_config(updated, False), original)
        self.assertEqual(pause.update_config(original, False), original)
        self.assertEqual(pause.update_config(updated, True), updated)

    def test_resume_keeps_candidate_upstream(self):
        original = 'server { server_name timo.clouddo.cc; proxy_pass http://172.17.0.1:3202; }'
        switched = pause.update_config(original, True).replace(':3202', ':3212')
        self.assertEqual(pause.update_config(switched, False), original.replace(':3202', ':3212'))

    def test_rejects_ambiguous_server_and_modified_markers(self):
        original = 'server { server_name timo.clouddo.cc; }'
        for value in (original * 2, original.replace('timo', 'another'),
                      pause.update_config(original, True).replace('return 503', 'return 502')):
            with self.assertRaises(ValueError):
                pause.update_config(value, False)


if __name__ == '__main__':
    unittest.main()
