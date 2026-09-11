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
        assert genres == ["Екшен"]
        assert themes == ["Школа"]
    finally:
        asyncio.run(core.close())


def test_shikimori_page_taxonomy_uses_visible_genre_theme_rows():
    core = Core()
    try:
        html = """
        <div class="b-entry-info">
          <div class="line-container"><div class="key">Жанры:</div>
            <a class="b-tag" href="/animes/genre/27-Shounen">Shounen Сёнен</a>
            <a class="b-tag" href="/animes/genre/1-Action">Action Экшен</a>
            <a class="b-tag" href="/animes/genre/37-Supernatural">Supernatural Сверхъестественное</a>
          </div>
          <div class="line-container"><div class="key">Темы:</div>
            <a class="b-tag" href="/animes/genre/114-Award-Winning">Award Winning Удостоено наград</a>
            <a class="b-tag" href="/animes/genre/23-School">School Школа</a>
          </div>
        </div>
        """
        soup = BeautifulSoup(html, "html.parser")
        genres, themes, ok = core.shikimori_taxonomy_from_soup(soup)
        assert ok is True
        assert genres == ["Сьонен", "Екшен", "Надприродне"]
        assert themes == ["Відзначене нагородами", "Школа"]
    finally:
        asyncio.run(core.close())


def test_mal_taxonomy_uses_section_labels():
    async def run():
        core = Core()
        html = """
        <div class="spaceit_pad"><span class="dark_text">Genres:</span>
          <a href="/anime/genre/1/Action">Action</a><a href="/anime/genre/10/Fantasy">Fantasy</a>
        </div>
        <div class="spaceit_pad"><span class="dark_text">Themes:</span>
          <a href="/anime/genre/62/Isekai">Isekai</a><a href="/anime/genre/38/Military">Military</a>
        </div>
        """

        class Response:
            status_code = 200
            text = html
            headers = {}

        async def fake_authority_request(*args, **kwargs):
            return Response()

        core.authority_request = fake_authority_request
        try:
            genres, themes = await core.myanimelist_taxonomy(1)
            assert genres == ["Екшен", "Фентезі"]
            assert themes == ["Ісекай", "Військове"]
        finally:
            await core.close()

    asyncio.run(run())


def test_anilist_by_mal_retries_transient_503():
    async def run():
        core = Core()
        calls = {"n": 0}

        class Response:
            headers = {}

            def __init__(self, status_code, payload):
                self.status_code = status_code
                self._payload = payload

            def json(self):
                return self._payload

        async def fake_request(method, url, **kwargs):
            calls["n"] += 1
            if calls["n"] < 3:
                return Response(503, {})
            return Response(200, {
                "data": {
                    "Media": {
                        "id": 113415,
                        "idMal": 40748,
                        "title": {
                            "romaji": "Jujutsu Kaisen",
                            "english": "Jujutsu Kaisen",
                            "native": "呪術廻戦",
                        },
                        "synonyms": [],
                        "genres": ["Action", "Supernatural"],
                        "coverImage": {},
                    }
                }
            })

        async def no_sleep(_):
            return None

        core.request = fake_request
        original_sleep = asyncio.sleep
        asyncio.sleep = no_sleep
        try:
            media, ok, error = await core.anilist_by_mal_id_result(40748)
            assert ok is True
            assert error == ""
            assert media["id"] == 113415
            assert calls["n"] == 3
        finally:
            asyncio.sleep = original_sleep
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
        assert payload["all"] == ["Екшен", "Фентезі", "Пригоди", "Драма"]
        assert payload["sources"]["anilist.co"] == ["Фентезі", "Драма"]
    finally:
        asyncio.run(core.close())


def test_direct_mal_taxonomy_path_avoids_broad_authority_search():
    class FastTaxonomyCore(Core):
        def __init__(self):
            super().__init__()
            self.broad_called = False

        async def resolve_authorities(self, payload, extra_queries=None):
            self.broad_called = True
            raise AssertionError("broad resolver must not run for a canonical MAL URL")

        async def anilist_by_mal_id_result(self, mal_id):
            assert mal_id == 40748
            return ({
                "id": 113415,
                "idMal": 40748,
                "title": {"romaji": "Jujutsu Kaisen", "english": "Jujutsu Kaisen", "native": "呪術廻戦"},
                "synonyms": [],
                "genres": ["Action", "Supernatural"],
                "coverImage": {},
            }, True, "")

        async def shikimori_details(self, anime_id):
            assert anime_id == 40748
            return {
                "id": 40748,
                "name": "Jujutsu Kaisen",
                "russian": "Магическая битва",
                "english": ["Jujutsu Kaisen"],
                "japanese": ["呪術廻戦"],
                "synonyms": [],
            }

        async def shikimori_page_taxonomy(self, anime_id):
            return ["Shounen", "Action", "Supernatural"], ["Award Winning", "School"], True, ""

        async def myanimelist_taxonomy_result(self, mal_id):
            return ["Action", "Award Winning", "Supernatural"], ["School"], True, ""

    async def run():
        from app import InputPayload

        core = FastTaxonomyCore()
        try:
            data, status = await core.resolve_taxonomy_authorities(
                InputPayload(title="Jujutsu Kaisen", url="https://myanimelist.net/anime/40748")
            )
            assert core.broad_called is False
            assert data.anilist_id == 113415
            assert data.genres["anilist.co"] == ["Екшен", "Надприродне"]
            assert data.genres["shikimori.io"] == ["Сьонен", "Екшен", "Надприродне"]
            assert data.themes["shikimori.io"] == ["Відзначене нагородами", "Школа"]
            assert all(entry["ok"] for entry in status.values())
        finally:
            await core.close()

    asyncio.run(run())


def test_anilist_null_media_is_not_success():
    async def run():
        core = Core()

        async def fake_graphql(query, variables, retries=4):
            return {"data": {"Media": None}}, True, ""

        core.anilist_graphql = fake_graphql
        try:
            media, ok, error = await core.anilist_by_mal_id_result(999999)
            assert media is None
            assert ok is False
            assert "no media for MAL id 999999" in error
        finally:
            await core.close()

    asyncio.run(run())


def test_anilist_only_identity_marks_mal_and_shikimori_not_found():
    class AniListOnlyCore(Core):
        async def anilist_by_id_result(self, media_id):
            assert media_id == 777001
            return ({
                "id": 777001,
                "idMal": None,
                "title": {"romaji": "AniList Only", "english": "", "native": ""},
                "synonyms": [],
                "genres": ["Fantasy"],
                "coverImage": {},
            }, True, "")

        async def myanimelist_taxonomy_result(self, mal_id):
            assert mal_id is None
            return [], [], False, "missing MAL id"

        async def shikimori_page_taxonomy(self, anime_id):
            assert anime_id is None
            return [], [], False, "missing MAL/Shikimori id"

    async def run():
        from app import InputPayload

        core = AniListOnlyCore()
        try:
            data, status = await core.resolve_taxonomy_authorities(
                InputPayload(title="AniList Only", url="https://anilist.co/anime/777001")
            )
            assert data.anilist_id == 777001
            assert data.mal_id is None
            assert status["anilist.co"]["ok"] is True
            assert status["anilist.co"]["notFound"] is False
            assert status["myanimelist.net"]["ok"] is False
            assert status["myanimelist.net"]["notFound"] is True
            assert status["shikimori.io"]["ok"] is False
            assert status["shikimori.io"]["notFound"] is True
        finally:
            await core.close()

    asyncio.run(run())


def test_taxonomy_translation_covers_common_labels():
    from app import taxonomy_uk_name

    assert taxonomy_uk_name("Action") == "Екшен"
    assert taxonomy_uk_name("Supernatural") == "Надприродне"
    assert taxonomy_uk_name("Shounen") == "Сьонен"
    assert taxonomy_uk_name("Historical") == "Історичне"
    assert taxonomy_uk_name("Sci-Fi") == "Наукова фантастика"
    assert taxonomy_uk_name("Time Travel") == "Подорожі в часі"
    assert taxonomy_uk_name("Ісекай") == "Ісекай"
