# Anime -> YORU Collector v3.1.1

Turso edition with schema-v3 Genre/Theme support.

AniList genres use a client-side fallback: if the Vercel core cannot read AniList from shared serverless egress, Tampermonkey queries `https://graphql.anilist.co` directly from the user's connection before sending the final JSON to `/api/ingest`.

Firefox stream bridge behavior is unchanged.
