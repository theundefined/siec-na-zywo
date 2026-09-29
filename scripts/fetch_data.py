#!/usr/bin/env python3
"""Pobiera dane, których nie da się czytać bezpośrednio z przeglądarki (brak CORS), do web/data/.

Ceny gazu TGEgasDA (RDNg): dane TGE w opracowaniu Instrat (energy.instrat.pl), licencja CC BY-NC 4.0.
Uruchamiane przez GitHub Actions przed każdym wdrożeniem strony; lokalnie: python3 scripts/fetch_data.py
"""
import json
import pathlib
import urllib.request
from datetime import datetime, timedelta, timezone

OUT = pathlib.Path(__file__).resolve().parent.parent / 'web' / 'data'
API = 'https://energy-api.instrat.pl/api/prices/gas_price_rdn_daily'


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'siec-na-zywo (+https://github.com/theundefined/siec-na-zywo)'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    since = (datetime.now(timezone.utc) - timedelta(days=400)).strftime('%Y-%m-%dT00:00:00Z')
    rows = fetch(f'{API}?date_from={since}')
    data = [{'day': r['date'][:10], 'price': r['price'], 'volume': r['volume']} for r in rows if r.get('indeks') == 'tgegasda' and r.get('price') is not None]
    if not data:
        raise SystemExit('Brak danych z API Instrat')
    doc = {
        'fetched': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'index': 'TGEgasDA',
        'unit': {'price': 'PLN/MWh', 'volume': 'MWh'},
        'source': 'Towarowa Giełda Energii (TGE), opracowanie: Instrat — energy.instrat.pl',
        'license': 'CC BY-NC 4.0',
        'data': data,
    }
    (OUT / 'gas-prices.json').write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(f'gas-prices.json: {len(data)} dni, ostatni {data[-1]["day"]}')


if __name__ == '__main__':
    main()
