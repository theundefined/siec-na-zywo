#!/usr/bin/env python3
"""Pobiera do web/data/ dane, których przeglądarka nie może czytać bezpośrednio (brak CORS lub parsowanie strony).

- gas-prices.json — ceny gazu TGEgasDA (RDNg): dane TGE w opracowaniu Instrat (energy.instrat.pl), licencja CC BY-NC 4.0.
- capacity.json   — moc osiągalna elektrowni wg paliw (ARE S.A., statystyka publiczna), z wykresu na stronie ARE.

Każde źródło jest niezależne: gdy któreś zawiedzie, zapisujemy ostatnią opublikowaną kopię (z GitHub Pages), więc
wdrożenie strony nigdy nie pada przez jedno źródło. Każdy plik ma pola `fetched` (kiedy pobrano) i `dataAsOf`
(z kiedy są dane) — strona ostrzega, gdy są starsze niż zwykle.

Uruchamiane przez GitHub Actions przed każdym wdrożeniem; lokalnie: python3 scripts/fetch_data.py
"""
import json
import pathlib
import re
import sys
import urllib.request
from datetime import datetime, timezone

OUT = pathlib.Path(__file__).resolve().parent.parent / 'web' / 'data'
PUBLISHED = 'https://theundefined.github.io/siec-na-zywo/data'
UA = 'siec-na-zywo (+https://github.com/theundefined/siec-na-zywo)'


def get(url, timeout=60):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8')


def now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def gas_prices():
    rows = json.loads(get('https://energy-api.instrat.pl/api/prices/gas_price_rdn_daily?date_from=2019-01-01T00:00:00Z', 120))
    data = [{'day': r['date'][:10], 'price': r['price'], 'volume': r['volume']} for r in rows if r.get('indeks') == 'tgegasda' and r.get('price') is not None]
    if len(data) < 300:
        raise ValueError(f'za mało danych z API Instrat ({len(data)})')
    data.sort(key=lambda x: x['day'])
    return {
        'fetched': now(), 'dataAsOf': data[-1]['day'],
        'index': 'TGEgasDA', 'unit': {'price': 'PLN/MWh', 'volume': 'MWh'},
        'source': 'Towarowa Giełda Energii (TGE), opracowanie: Instrat — energy.instrat.pl', 'license': 'CC BY-NC 4.0',
        'data': data,
    }


# Kategorie ARE (po nazwie, nie po kolejności zmiennych) → kody grup strony.
ARE_MAP = {
    'Węgiel kamienny': 'WK', 'Węgiel brunatny': 'WB', 'Gaz ziemny': 'GZ', 'OZE - biomasa': 'BM', 'OZE - biogaz': 'BG',
    'OZE - el. wodne': 'WODA', 'OZE - fotowoltaika': 'PV', 'OZE - el. wiatrowe': 'WIATR', 'OZE - instalacje hybrydowe': 'HYBRYDY',
    'OZE - inne': 'OZE_INNE', 'Pozostałe paliwa': 'INNE',
}


def capacity():
    html = get('https://www.are.waw.pl/badania-statystyczne/prezentacja-wybranych-danych', 90)
    # Dane wykresów są osadzone w strumieniu Next.js (self.__next_f.push([1, "..."])).
    parts = re.findall(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)', html)
    flight = ''.join(json.loads('"' + p + '"') for p in parts)
    for m in re.finditer(r'"metaData":\{"label_x_axis":"[^"]*","label_y_axis":"Moc \[MW\]","variables":(\[.*?\])', flight):
        variables = json.loads(m.group(1))
        start = flight.rfind('"data":[', 0, m.start())
        data, _ = json.JSONDecoder().raw_decode(flight, start + len('"data":'))
        names = {v['variable']: v['display_name'] for v in variables}
        if 'Węgiel brunatny' not in names.values():
            continue
        last = max(data, key=lambda r: (r['year'], r['month'] or 0))
        mw = {}
        for var, name in names.items():
            code = ARE_MAP.get(name)
            if code is None:
                raise ValueError(f'nieznana kategoria ARE: {name}')
            mw[code] = round(float(last.get(var) or 0), 3)
        total = sum(mw.values())
        if not (40000 < total < 250000) or mw['WK'] < 1000:
            raise ValueError(f'nieprawdopodobna suma mocy ARE: {total:.0f} MW')
        return {
            'fetched': now(), 'dataAsOf': f"{last['year']}-{last['month']:02d}",
            'unit': 'MW', 'mw': mw,
            'source': 'ARE S.A. — Moc elektryczna osiągalna (stan na koniec miesiąca) wg rodzajów paliw i technologii wytwarzania',
            'url': 'https://www.are.waw.pl/badania-statystyczne/prezentacja-wybranych-danych',
        }
    raise ValueError('nie znaleziono wykresu mocy osiągalnej na stronie ARE')


SOURCES = {'gas-prices.json': gas_prices, 'capacity.json': capacity}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    failed = []
    for name, fn in SOURCES.items():
        try:
            doc = fn()
            print(f'{name}: OK, dane z {doc["dataAsOf"]}')
        except Exception as e:  # noqa: BLE001 — każde źródło niezależnie
            failed.append(name)
            print(f'{name}: BŁĄD {e!r} — używam ostatniej opublikowanej kopii', file=sys.stderr)
            try:
                doc = json.loads(get(f'{PUBLISHED}/{name}'))
                doc['stale'] = f'nie udało się odświeżyć: {type(e).__name__}'
            except Exception as e2:  # noqa: BLE001
                print(f'{name}: brak też opublikowanej kopii ({e2!r}) — pomijam', file=sys.stderr)
                continue
        (OUT / name).write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    if failed:
        print('Nieodświeżone źródła: ' + ', '.join(failed), file=sys.stderr)


if __name__ == '__main__':
    main()
