from bs4 import BeautifulSoup

from app import site_specific_title_variants, source_page_title_variants


def soup(html: str):
    return BeautifulSoup(html, 'html.parser')


def test_anihub_original_title_below_h1():
    doc = soup('''
      <div>
        <h1>Поганий соратник для групи героя обрав спокійне життя в селі 2</h1>
        <p class="text-sm text-gray-400 mb-1">Shin no Nakama ja Nai to Yuusha no Party wo Oidasareta node, Henkyou de Slow Life suru Koto ni Shimashita 2nd</p>
      </div>
    ''')
    values = site_specific_title_variants('anihub.in.ua', doc)
    assert any(v.startswith('Shin no Nakama') and v.endswith('2nd') for v in values)


def test_jutsu_net_original_block():
    doc = soup('''
      <div class="jutsu-page__title-text"><h1>Меня выгнали из гильдии героев</h1>
      <div class="jutsu-page__original">Shin no Nakama ja Nai to Yuusha no Party wo Oidasareta node, Henkyou de Slow Life suru Koto ni Shimashita 2nd</div></div>
    ''')
    values = site_specific_title_variants('jut-su.net', doc)
    assert any(v.startswith('Shin no Nakama') for v in values)


def test_jutsu_original_label():
    doc = soup('''
      <div>
        Жанры: приключения<br>
        Оригинальное название: <b>Shin no Nakama ja Nai to Yuusha no Party wo Oidasareta node, Henkyou de Slow Life suru Koto ni Shimashita</b><br>
        Возрастной рейтинг: 16+
      </div>
    ''')
    values = site_specific_title_variants('jut.su', doc)
    assert any(v.startswith('Shin no Nakama') for v in values)


def test_source_page_variants_include_visible_and_original():
    doc = soup('''
      <h1>Нове життя блискучого цілителя в тіні</h1>
      <p class="text-sm text-gray-400 mb-1">Isshun de Chiryou shiteita noni Yakutatazu to Tsuihou sareta Tensai Chiyushi</p>
    ''')
    values = source_page_title_variants('anihub.in.ua', doc)
    assert 'Нове життя блискучого цілителя в тіні' in values
    assert any(v.startswith('Isshun de Chiryou') for v in values)


def test_anihub_trusted_titles_do_not_include_navigation_noise():
    from app import trusted_source_title_variants
    doc = soup('''
      <nav><span class="text-sm text-gray-400 mb-1">Telegram</span><span>TikTok</span></nav>
      <div>
        <h1>Володар Таємниць</h1>
        <p class="text-sm text-gray-400 mb-1">Guimi Zhi Zhu: Xiaochou Pian</p>
      </div>
      <footer><span class="text-gray-400">Підтримка</span></footer>
    ''')
    values = trusted_source_title_variants('anihub.in.ua', doc)
    assert values[0] == 'Guimi Zhi Zhu: Xiaochou Pian'
    assert 'Володар Таємниць' in values
    assert 'Telegram' not in values
    assert 'TikTok' not in values
    assert 'Підтримка' not in values
    assert len(values) <= 3
