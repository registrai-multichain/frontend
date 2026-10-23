"""Compile research results into docs/ecosystem-review/2026-10-23.json (ReviewItem[]), applying the review rulings."""
import json, glob, os
R = os.path.dirname(os.path.abspath(__file__))
E = {e['slug']: e for e in json.load(open('src/data/arc-ecosystem/entities.json'))}
# Rulings (ledgered): provider-list-only mentions, pre-launch deploys and V3-only dates give no launch date
NO_DATE = {'bungee', 'chainlink', 'layerzero', 'pimlico', 'turnkey', 'zerodev', 'tenderly', 'quicknode', 'relay', 'lift', 'unitflow-finance',
           'lagoon', 'sushiswap', 'lunya', 'solonpad', 'arctools', 'kairo', 'foci', 'argus', 'faze', 'juno'}
results = {}
for f in sorted(glob.glob(os.path.join(R, 'result-*.json'))):
    d = json.load(open(f))
    for r in (d['results'] if isinstance(d, dict) else d):
        results[r['slug']] = r
BLOG = 'https://www.arc.io/blog/arc-economic-os-internet'
# review fixes: cite the launch blog's trading list ("Live and liquid markets from launch") for these
OVERRIDE_EV = {'o1-exchange': {'url': BLOG, 'title': 'Arc mainnet launch post: Live and liquid markets from launch', 'date': '2026-09-16'},
               'li-fi': {'url': BLOG, 'title': 'Arc mainnet launch post: Live and liquid markets from launch', 'date': '2026-09-16'}}
for k, v in OVERRIDE_EV.items():
    results[k] = {**results.get(k, {'slug': k}), 'slug': k, 'first_live': '2026-09-16', 'evidence': v}
# review fixes: named live by the launch post but outside the researched categories
for k in ['coins-ph', 'ether-fi']:
    results[k] = {'slug': k, 'first_live': '2026-09-16', 'status': 'live', 'evidence': {'url': BLOG, 'title': 'Arc mainnet launch post (exchanges live on Arc; wallets and apps from day one)', 'date': '2026-09-16'}}
items = []
def short(t, n=80): return t if len(t) <= n else t[:n - 1].rstrip() + '…'
for slug, r in results.items():
    e = E.get(slug)
    if not e: print('unknown slug', slug); continue
    fl = None if slug in NO_DATE else r.get('first_live')
    ev = r.get('evidence') if fl else None
    if fl and (not ev or ev.get('date') != fl or not ev.get('url', '').startswith('https://')): print('bad evidence', slug); continue
    title = short(ev['title']) if ev else None
    st = r.get('status')
    if st == 'live' and e['status'] != 'live':
        src = r.get('status_source') or (ev and ev['url'])
        official = ev and any(h in ev['url'] for h in ('://www.arc.io/', '://arc.io/', '://www.circle.com/', '://circle.com/'))
        evidence = ev and {'url': ev['url'], 'title': title, 'date': ev['date'], **({'type': 'arc-official-live'} if official else {})} or {'url': src, 'title': 'Project documentation lists Arc mainnet', 'type': 'mainnet-support'}
        items.append({'slug': slug, 'field': 'status', 'set': {'status': 'live', **({'first_live': fl} if fl else {})}, 'evidence': evidence,
                      'change': short(f"{e['status'].capitalize()} → Live on mainnet{f', since {fl}' if fl else ''}, per {title or 'its documentation'}", 200), 'source': evidence['url']})
        continue
    if fl:
        if slug not in OVERRIDE_EV and e.get('first_live') == fl and any(s.get('date') == fl for s in e['status_evidence'] + e['sources']): continue
        change = f"Live since {fl}, per {title}" if e.get('first_live') != fl else f"Source added for the launch date {fl}: {title}"
        items.append({'slug': slug, 'field': 'dates', 'set': {'first_live': fl}, 'evidence': {'url': ev['url'], 'title': title, 'date': fl}, 'change': short(change, 200), 'source': ev['url']})
    elif e.get('first_live'):
        items.append({'slug': slug, 'field': 'dates', 'set': {'first_live': None}, 'change': f"Launch date {e['first_live']} removed: it was the day Registrai first saw the app; no source states the launch date",
                      'source': e.get('website') or e['sources'][0]['url']})
# KPK: its own docs say the vault went live with Arc mainnet; status follows (review fix)
KPK_DOCS = 'https://docs.kpk.io/vaults/vaults/morpho/arc/wars-yield'
if E['kpk']['status'] != 'live':
    items = [i for i in items if i['slug'] != 'kpk']
    items.append({'slug': 'kpk', 'field': 'status', 'set': {'status': 'live', 'first_live': '2026-09-16'}, 'evidence': {'url': KPK_DOCS, 'title': 'KPK docs: the vault went live alongside Arc mainnet on 16 September 2026', 'date': '2026-09-16', 'type': 'mainnet-support'},
                  'change': 'Deployed → Live on mainnet, since 2026-09-16, per its docs', 'source': KPK_DOCS})
# validators (batch f ruling)
VAL = 'https://www.circle.com/pressroom/circle-launches-arc-mainnet-an-economic-operating-system-for-the-internet'
for slug in ['blackrock', 'sbi-holdings']:
    if 'validators' not in (E[slug].get('tags') or []) and E[slug]['category'] != 'validators':
        items.append({'slug': slug, 'field': 'category', 'set': {'add_tags': ['validators']}, 'change': 'Also listed under Validators: named in Circle’s founding validator cohort', 'source': VAL})
for i in items: assert 5 <= len(i['change']) <= 200, i
os.makedirs('docs/ecosystem-review', exist_ok=True)
json.dump(items, open('docs/ecosystem-review/2026-10-23.json', 'w'), indent=2, ensure_ascii=False)
from collections import Counter
print(len(items), Counter(i['field'] for i in items), 'removed dates:', sum(1 for i in items if i['set'].get('first_live', 0) is None))
