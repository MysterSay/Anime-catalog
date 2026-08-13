import asyncio
import sys
from pathlib import Path

CORE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CORE_DIR))

from app import AuthorityData, Core, InputPayload  # noqa: E402


class OrderedProcessCore(Core):
    def __init__(self):
        self.calls = []
        self.http_sem = asyncio.Semaphore(24)
        self.google_sem = asyncio.Semaphore(6)
        self.client = None

    async def close(self):
        return None

    async def seed_source_catalog(self, payload):
        return (
            'anihub.in.ua',
            {
                'url': payload.url,
                'title': payload.title,
                '_aliases': ['Guimi Zhi Zhu: Xiaochou Pian', payload.title],
            },
            ['Guimi Zhi Zhu: Xiaochou Pian', payload.title],
        )

    async def resolve_authorities(self, payload, extra_queries=None):
        return AuthorityData(
            original='Guimi Zhi Zhu: Xiaochou Pian',
            english='Lord of Mysteries',
            native='诡秘之主 小丑篇',
            aliases=[
                'Guimi Zhi Zhu: Xiaochou Pian',
                'Lord of Mysteries',
                'Повелитель тайн: Клоун',
                '诡秘之主 小丑篇',
            ],
            description='Description',
        )

    async def search_catalog_native(self, domain, queries, identity_aliases, authority):
        query = queries[0]
        self.calls.append(('native', domain, query))
        if domain == 'jut-su.net' and query == 'Повелитель тайн: Клоун':
            return [{
                'url': 'https://jut-su.net/5539-povelitel-tajn-h1.html',
                'title': 'Повелитель тайн: Клоун',
                '_aliases': ['Guimi Zhi Zhu: Xiaochou Pian'],
            }]
        return []

    async def google_catalog_fallback(self, domain, queries, identity_aliases):
        self.calls.append(('google', domain, tuple(queries)))
        return []

    async def translate_uk(self, text):
        return 'Володар Таємниць'

    async def translate_ru(self, text):
        return 'Повелитель тайн: Клоун'

    async def send_callback(self, result):
        return None


async def _ordered_case():
    core = OrderedProcessCore()
    try:
        result = await core.process(InputPayload(
            title='Володар Таємниць',
            url='https://anihub.in.ua/anime/volodar-tayemnyts-12208',
        ), callback=False)
    finally:
        await core.close()
    jut_calls = [query for kind, domain, query in core.calls if kind == 'native' and domain == 'jut-su.net']
    assert jut_calls == [
        'Guimi Zhi Zhu: Xiaochou Pian',
        'Lord of Mysteries',
        'Повелитель тайн: Клоун',
    ]
    assert result['catalogs']['jut-su.net'][0]['url'].endswith('5539-povelitel-tajn-h1.html')
    assert not any(kind == 'google' and domain == 'jut-su.net' for kind, domain, *_ in core.calls)


def test_ru_catalog_uses_original_then_english_then_russian_and_stops():
    asyncio.run(_ordered_case())


class DlePreferenceCore(Core):
    def __init__(self):
        self.http_sem = asyncio.Semaphore(24)
        self.google_sem = asyncio.Semaphore(6)
        self.client = None
        self.calls = []

    async def close(self):
        return None

    async def search_dle_post(self, domain, queries, identity_aliases):
        self.calls.append(('dle', domain, tuple(queries)))
        return [{'url': 'https://jut-su.net/5539-povelitel-tajn-h1.html', 'title': 'Повелитель тайн: Клоун'}]

    async def generic_site_search(self, domain, queries, identity_aliases, *, compact=False):
        self.calls.append(('generic', domain, tuple(queries)))
        return []


async def _dle_case():
    core = DlePreferenceCore()
    try:
        result = await core.search_catalog_native(
            'jut-su.net',
            ['Guimi Zhi Zhu: Xiaochou Pian'],
            ['Guimi Zhi Zhu: Xiaochou Pian', 'Повелитель тайн: Клоун'],
            AuthorityData(),
        )
    finally:
        await core.close()
    assert result
    assert core.calls == [('dle', 'jut-su.net', ('Guimi Zhi Zhu: Xiaochou Pian',))]


def test_jutsu_net_uses_dle_form_before_generic_routes():
    asyncio.run(_dle_case())

from bs4 import BeautifulSoup  # noqa: E402


class JutsuVerifyCore(Core):
    def __init__(self):
        self.http_sem = asyncio.Semaphore(24)
        self.google_sem = asyncio.Semaphore(6)
        self.client = None

    async def close(self):
        return None

    async def fetch_soup(self, url):
        return BeautifulSoup('''
          <html><body>
            <div class="jutsu-page__title-text">
              <h1>Повелитель тайн: Клоун</h1>
              <div class="jutsu-page__original">Guimi Zhi Zhu: Xiaochou Pian</div>
            </div>
          </body></html>
        ''', 'html.parser'), url


async def _jutsu_fixture_case():
    core = JutsuVerifyCore()
    try:
        search_html = '''
          <div class="search-result">
            <a href="/5539-povelitel-tajn-h1.html"><img alt="Повелитель тайн: Клоун"></a>
            <a href="/5539-povelitel-tajn-h1.html">Повелитель тайн: Клоун</a>
          </div>
        '''
        loose = core.parse_loose_catalog_candidates(
            search_html,
            'https://jut-su.net/index.php?do=search',
            'jut-su.net',
            30,
        )
        verified = await core.verify_candidates(
            'jut-su.net',
            loose,
            ['Guimi Zhi Zhu: Xiaochou Pian', 'Lord of Mysteries', 'Повелитель тайн: Клоун'],
        )
    finally:
        await core.close()
    assert verified
    assert verified[0]['url'] == 'https://jut-su.net/5539-povelitel-tajn-h1.html'
    assert verified[0]['verified_by'] in {'Guimi Zhi Zhu: Xiaochou Pian', 'Повелитель тайн: Клоун'}


def test_jutsu_search_card_is_verified_by_original_title_on_destination_page():
    asyncio.run(_jutsu_fixture_case())
