import asyncio
from bs4 import BeautifulSoup
from app import Core


def test_shikimori_taxonomy_separates_genres_and_themes():
    core = Core()
    try:
        genres, themes = core.shikimori_taxonomy({"genres": [
            {"name": "Action", "kind": "genre"},
            {"name": "School", "kind": "theme"},
            {"name": "Action", "kind": "genre"},
            {"name": "Shounen", "kind": "demographic"},
        ]})
        assert genres == ["Action"]
        assert themes == ["School"]
    finally:
        asyncio.run(core.close())


def test_mal_taxonomy_uses_section_labels():
    async def run():
        core = Core()
        html = '''
        <div class="spaceit_pad"><span class="dark_text">Genres:</span>
          <a href="/anime/genre/1/Action">Action</a><a href="/anime/genre/10/Fantasy">Fantasy</a>
        </div>
        <div class="spaceit_pad"><span class="dark_text">Themes:</span>
          <a href="/anime/genre/62/Isekai">Isekai</a><a href="/anime/genre/38/Military">Military</a>
        </div>
        '''
        async def fake_fetch(url):
            return BeautifulSoup(html, "html.parser"), url
        core.fetch_soup = fake_fetch
        try:
            genres, themes = await core.myanimelist_taxonomy(1)
            assert genres == ["Action", "Fantasy"]
            assert themes == ["Isekai", "Military"]
        finally:
            await core.close()
    asyncio.run(run())


def test_taxonomy_payload_merges_sources_case_insensitively():
    core = Core()
    try:
        payload = core.taxonomy_payload({
            "myanimelist.net": ["Action", "Fantasy"],
            "shikimori.io": ["Action", "Adventure"],
            "anilist.co": ["Fantasy", "Drama"],
        }, ["myanimelist.net", "shikimori.io", "anilist.co"])
        assert payload["all"] == ["Action", "Fantasy", "Adventure", "Drama"]
        assert payload["sources"]["anilist.co"] == ["Fantasy", "Drama"]
    finally:
        asyncio.run(core.close())
