from pathlib import Path

from django.conf import settings
from django.test import TestCase


class OrbeeMascotTests(TestCase):
    def test_home_and_workspaces_share_one_collapsed_chat_without_changing_map(self):
        for url in ('/map/', '/workspace/crops/', '/workspace/market/', '/workspace/nasa/', '/workspace/alerts/'):
            page = self.client.get(url)
            self.assertContains(page, 'id="orbee-widget"', count=1)
            self.assertContains(page, 'id="orbee-chat"', count=1)
            self.assertContains(page, 'aria-controls="orbee-chat"')
            self.assertContains(page, 'aria-expanded="false"')
            self.assertContains(page, 'role="dialog" aria-modal="false" tabindex="-1" hidden')
        home = self.client.get('/map/')
        self.assertContains(home, 'id="live-map"')
        self.assertContains(home, 'id="field-results-dialog"')

    def test_orbee_page_has_a_single_mascot_chat_and_no_duplicate_launcher(self):
        page = self.client.get('/workspace/orbee/')
        self.assertContains(page, 'orbee-portrait orbee-sprite')
        self.assertContains(page, 'id="orbee-chat"', count=1)
        self.assertContains(page, 'id="orbee-chat-form"')
        self.assertContains(page, 'role="log"')
        self.assertContains(page, 'maxlength="2000"')
        self.assertContains(page, 'id="orbee-ai-status"')
        self.assertContains(page, 'id="orbee-share-field"')
        self.assertNotContains(page, 'id="orbee-launcher"')
        self.assertNotContains(page, 'class="orbee-avatar"')
        for topic in ('crop', 'weather', 'soil', 'rotation', 'market', 'disease'):
            self.assertContains(page, f'data-orbee="{topic}"')

    def test_mascot_artwork_is_local_and_has_both_pose_cells(self):
        artwork = Path(settings.BASE_DIR) / 'website/static/website/orbee/orbee-poses.png'
        content = artwork.read_bytes()
        self.assertEqual(content[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(int.from_bytes(content[16:20], 'big'), 1536)
        self.assertEqual(int.from_bytes(content[20:24], 'big'), 1024)
        self.assertEqual(content[25], 6)  # RGBA; no flattened black background.
        web = artwork.with_suffix('.webp').read_bytes()
        self.assertEqual(web[:4], b'RIFF')
        self.assertEqual(web[8:12], b'WEBP')
        self.assertLess(len(web), len(content) // 3)
