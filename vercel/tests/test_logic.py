import asyncio
import unittest

from app import AuthorityData, Core, InputPayload, title_relation_score


class ResolveCore(Core):
    def __init__(self, ani_map):
        self.ani_map = ani_map
        self.http_sem = asyncio.Semaphore(24)
        self.google_sem = asyncio.Semaphore(6)
        self.client = None

    async def close(self):
        return None

    async def translate_en(self, text):
        return "Sword Art Online"

    async def anilist_search(self, title):
        return self.ani_map.get(title, [])

    async def shikimori_authority_search(self, query):
        return []

    async def google_site_search(self, domain, title, limit=12):
        return []

    async def fetch_soup(self, url):
        return None, url

    async def request(self, method, url, **kwargs):
        raise RuntimeError("network disabled in unit test")


class ProcessCore(Core):
    def __init__(self):
        self.calls = []
        self.http_sem = asyncio.Semaphore(24)
        self.google_sem = asyncio.Semaphore(6)
        self.client = None

    async def close(self):
        return None

    async def resolve_authorities(self, payload):
        return AuthorityData(
            aliases=["Sword Art Online"],
            original="Sword Art Online",
            english="Sword Art Online",
            description="Description",
            anilist_id=11757,
            mal_id=11757,
        )

    async def seed_source_catalog(self, payload):
        return None, None

    async def search_catalog_native(self, domain, queries, identity_aliases, authority):
        self.calls.append(("native", domain, tuple(queries)))
        # First pass teaches one RU and one UA localized title.
        if tuple(queries) == ("Sword Art Online",):
            if domain == "shikimori.io":
                return [{"url": "https://shikimori.io/animes/11757", "title": "Мастера Меча Онлайн"}]
            if domain == "anihub.in.ua":
                return [{"url": "https://anihub.in.ua/anime/sao", "title": "Майстри меча онлайн"}]
            return []
        if queries == ["Мастера Меча Онлайн"] and domain == "jut.su":
            return [{"url": "https://jut.su/sao/", "title": "Мастера Меча Онлайн"}]
        if queries == ["Майстри меча онлайн"] and domain == "anitube.in.ua":
            return [{"url": "https://anitube.in.ua/sao.html", "title": "Майстри меча онлайн"}]
        return []

    async def google_catalog_fallback(self, domain, queries, identity_aliases):
        self.calls.append(("google", domain, tuple(queries)))
        return []

    async def translate_uk(self, text):
        return "Опис" if text == "Description" else "Майстри меча онлайн"

    async def translate_ru(self, text):
        return "Мастера Меча Онлайн"

    async def send_callback(self, result):
        return None


class LogicTests(unittest.IsolatedAsyncioTestCase):
    def test_series_relation(self):
        self.assertGreaterEqual(title_relation_score("Sword Art Online", "Sword Art Online Movie: Ordinal Scale"), 0.9)
        self.assertLess(title_relation_score("Sword Art Online", "Naruto"), 0.4)

    async def test_single_unrelated_authority_result_is_ignored(self):
        unrelated = {
            "id": 20,
            "idMal": 20,
            "title": {"romaji": "Naruto", "english": "Naruto", "native": "NARUTO"},
            "synonyms": [],
            "description": "",
            "bannerImage": None,
            "coverImage": {},
        }
        core = ResolveCore({
            "Мастера меча онлайн": [unrelated],
            "Sword Art Online": [unrelated],
        })
        result = await core.resolve_authorities(InputPayload(title="Мастера меча онлайн"))
        self.assertEqual(result.original, "Мастера меча онлайн")
        self.assertIsNone(result.anilist_id)

    async def test_catalog_search_has_three_phases(self):
        core = ProcessCore()
        result = await core.process(InputPayload(title="Мастера меча онлайн"), callback=False)
        self.assertTrue(result["catalogs"]["jut.su"])
        self.assertTrue(result["catalogs"]["anitube.in.ua"])
        # Original == English, therefore phase 1 must issue it only once per catalog.
        phase1 = [c for c in core.calls if c[0] == "native" and c[2] == ("Sword Art Online",)]
        self.assertTrue(phase1)
        self.assertTrue(any(c[0] == "native" and c[1] == "jut.su" and c[2] == ("Мастера Меча Онлайн",) for c in core.calls))
        self.assertTrue(any(c[0] == "native" and c[1] == "anitube.in.ua" and c[2] == ("Майстри меча онлайн",) for c in core.calls))
        # Google is only used for catalogs that remain empty after both native passes.
        self.assertFalse(any(c[0] == "google" and c[1] in {"jut.su", "anitube.in.ua"} for c in core.calls))


if __name__ == "__main__":
    unittest.main()
