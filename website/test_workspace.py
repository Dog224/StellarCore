from django.test import TestCase
from django.urls import reverse


class WorkspacePagesTests(TestCase):
    def test_vegetation_controls_and_requests_are_removed_from_pages(self):
        for path in ('/map/', '/workspace/nasa/', '/workspace/crops/'):
            page = self.client.get(path)
            for removed in ('results-tab-vegetation', 'results-panel-vegetation',
                            'data-layer="vegetation"', 'vegetation-monitor',
                            'nasa-ndvi', 'nasa-satellite', 'website/copernicus.js'):
                self.assertNotContains(page, removed)
            for retained in ('results-tab-crops', 'results-tab-weather', 'results-tab-plan'):
                self.assertContains(page, retained)

    def test_sidebar_links_open_real_pages_and_home_keeps_map_and_results(self):
        response = self.client.get('/map/')
        self.assertContains(response, 'id="live-map"')
        self.assertContains(response, 'id="field-results-dialog"')
        self.assertContains(response, 'home-side-column')
        self.assertNotContains(response, 'workspace.css')
        for section in ('crops', 'market', 'nasa', 'alerts', 'orbee'):
            self.assertContains(response, f'href="/workspace/{section}/"')
        sidebar = response.content.decode().split('<nav aria-label="Main navigation">')[1].split('</nav>')[0]
        self.assertNotIn('data-dialog=', sidebar)
        self.assertNotIn('href="#', sidebar)

    def test_each_workspace_has_its_own_route_active_state_and_existing_controls(self):
        for section in ('crops', 'market', 'nasa', 'alerts', 'orbee'):
            response = self.client.get(reverse('workspace', args=[section]))
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, f'data-workspace="{section}"')
            self.assertContains(response, 'workspace.css')
            self.assertContains(response, 'id="language-toggle"')
            self.assertContains(response, 'data-theme-toggle')
            self.assertContains(response, f'href="/workspace/{section}/" class="active" aria-current="page"')
            self.assertContains(response, 'id="map-config"')
            self.assertContains(response, 'data-mode="check"')
            self.assertContains(response, 'id="workspace-content"')
            self.assertNotContains(response, 'id="live-map"')
        self.assertEqual(self.client.get('/workspace/unknown/').status_code, 404)
        self.assertEqual(self.client.post('/workspace/market/', {}).status_code, 405)

    def test_mekong_has_six_selectable_conditions_and_no_invented_hazard_results(self):
        page = self.client.get('/workspace/alerts/')
        self.assertContains(page, 'Alert Mekong')
        self.assertContains(page, 'id="mekong-alert-map"')
        for condition in ('dry', 'flood', 'heat', 'rain', 'stress', 'air'):
            self.assertContains(page, f'data-condition="{condition}"')
        self.assertContains(page, 'Not assessed')
        self.assertContains(page, 'this is not a regional hazard map')

    def test_market_keeps_prices_and_adds_manual_income_scenario(self):
        page = self.client.get('/workspace/market/')
        self.assertContains(page, 'id="income-form"')
        self.assertContains(page, 'id="market-currency"')
        self.assertContains(page, 'not a yield forecast or guaranteed profit')
        self.assertContains(page, 'without daily, weekly or monthly dated observations')

    def test_orbee_is_guided_help_without_claiming_connected_ai(self):
        page = self.client.get('/workspace/orbee/')
        self.assertContains(page, 'Checking Claude connection')
        self.assertContains(page, 'data-orbee="soil"')
        self.assertContains(page, 'data-orbee="market"')
