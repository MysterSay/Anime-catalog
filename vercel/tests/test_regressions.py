import asyncio
import sys
from pathlib import Path

from bs4 import BeautifulSoup

CORE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CORE_DIR))

from app import (  # noqa: E402
    Core,
    InputPayload,
    is_catalog_title_url,
    soup_title_signals,
)


def test_title_signals_do_not_read_h2_or_navigation():
    soup = BeautifulSoup(
        '''
        <html><head><title>Арифурэта: Сильнейший ремесленник в мире смотреть аниме</title></head>
        <body>
          <nav><a href="/game/">Игры</a></nav>
          <main>
            <h1>Арифурэта: Сильнейший ремесленник в мире</h1>
            <div>8.4</div>
            <div>Arifureta Shokugyou de Sekai Saikyou</div>
            <h2>Новые способности</h2>
          </main>
        </body></html>
        ''',
        'html.parser',
    )
    signals = soup_title_signals(soup)
    assert 'Арифурэта: Сильнейший ремесленник в мире' in signals
    assert 'Arifureta Shokugyou de Sekai Saikyou' in signals
    assert 'Новые способности' not in signals
    assert 'Игры' not in signals


def test_catalog_url_filter_rejects_list_pages():
    assert is_catalog_title_url('jut-su.net', 'https://jut-su.net/42-arifurjeta-silnejshij-remeslennik-v-mire-z1.html')
    assert not is_catalog_title_url('jut-su.net', 'https://jut-su.net/game/')
    assert not is_catalog_title_url('jut-su.net', 'https://jut-su.net/anime/')
    assert not is_catalog_title_url('animego.studio', 'https://animego.studio/ova/')
    assert not is_catalog_title_url('anilibria.tv', 'https://aniliberty.top/anime/franchises/')


class MockAuthorityCore(Core):
    async def translate_en(self, text: str) -> str:
        return "Arifureta: The World's Strongest Artisan"

    async def anilist_search(self, title: str):
        return []

    async def anilist_by_mal_id(self, mal_id: int):
        return None

    async def shikimori_authority_search(self, query: str):
        if query == 'Арифурэта: Сильнейший ремесленник в мире':
            return [
                {
                    'id': 36882,
                    'name': 'Arifureta Shokugyou de Sekai Saikyou',
                    'russian': 'Арифурэта: Сильнейший ремесленник в мире',
                    'url': '/animes/36882-arifureta-shokugyou-de-sekai-saikyou',
                },
                {
                    'id': 99999,
                    'name': 'Completely Different Anime',
                    'russian': 'Совсем другое аниме',
                    'url': '/animes/99999-completely-different-anime',
                },
            ]
        return []

    async def shikimori_details(self, anime_id: int):
        if anime_id != 36882:
            return None
        return {
            'id': 36882,
            'name': 'Arifureta Shokugyou de Sekai Saikyou',
            'russian': 'Арифурэта: Сильнейший ремесленник в мире',
            'english': ["Arifureta: From Commonplace to World's Strongest"],
            'japanese': ['ありふれた職業で世界最強'],
            'synonyms': [],
            'url': '/animes/36882-arifureta-shokugyou-de-sekai-saikyou',
            'description': 'description',
            'image': {},
        }


async def _authority_case():
    core = MockAuthorityCore()
    try:
        data = await core.resolve_authorities(InputPayload(
            title='Арифурэта: Сильнейший ремесленник в мире',
            url='https://jut-su.net/42-arifurjeta-silnejshij-remeslennik-v-mire-z1.html',
        ))
    finally:
        await core.close()
    assert data.original == 'Arifureta Shokugyou de Sekai Saikyou'
    assert data.english == "Arifureta: From Commonplace to World's Strongest"
    assert data.mal_id == 36882
    assert 'Игры' not in data.aliases


def test_shikimori_exact_localized_hit_sets_romaji_original_without_anilist():
    asyncio.run(_authority_case())


class MockVerifyCore(Core):
    async def fetch_soup(self, url: str):
        soup = BeautifulSoup(
            '''<html><head><title>Совсем другой тайтл</title></head>
            <body><h1>Совсем другой тайтл</h1>
            <div>Арифурэта: Сильнейший ремесленник в мире</div></body></html>''',
            'html.parser',
        )
        return soup, url


async def _verify_case():
    core = MockVerifyCore()
    try:
        result = await core.verify_candidates(
            'jut-su.net',
            [{'url': 'https://jut-su.net/9999-drugoi-taitl.html', 'title': 'Совсем другой тайтл'}],
            ['Arifureta Shokugyou de Sekai Saikyou', 'Арифурэта: Сильнейший ремесленник в мире'],
        )
    finally:
        await core.close()
    assert result == []


def test_body_mention_does_not_turn_unrelated_page_into_result():
    asyncio.run(_verify_case())
