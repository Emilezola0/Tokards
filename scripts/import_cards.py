"""Convertit data/Tokards_cartes.xlsx en src/data/cards.json.

Usage : python -I scripts/import_cards.py [chemin.xlsx]
Seuls les decks marqués « Dans le jeu = Oui » sont jouables, mais tout est exporté.
"""
import json
import os
import sys

import openpyxl

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "Tokards_cartes.xlsx")
OUT = os.path.join(ROOT, "src", "data", "cards.json")


def rows(ws):
    it = ws.iter_rows(values_only=True)
    headers = [str(h or "").strip() for h in next(it)]
    for r in it:
        if not r or not r[0] or not str(r[0]).strip():
            continue
        yield {h: ("" if v is None else str(v).strip()) for h, v in zip(headers, r)}


def col(row, prefix):
    for k, v in row.items():
        if k.startswith(prefix) or prefix in k:
            return v
    return ""


wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
decks = []
for d in rows(wb["Decks"]):
    decks.append({"name": d["Deck"], "code": d["Code"], "inGame": d["Dans le jeu"].lower() == "oui",
                  "color": d.get("Couleur", ""), "description": d.get("Description", ""),
                  "keywords": [k.strip() for k in d.get("Mots-clés", "").split(",") if k.strip()],
                  "summary": d.get("Résumé du gameplay", ""), "back": d.get("Dos (image)", ""), "cards": [], "vcs": []})
by_name = {d["name"]: d for d in decks}


def card(r, kind):
    return {
        "id": r["ID"], "kind": kind, "deck": r["Deck"], "name": r["Nom"],
        "tags": {"sentience": col(r, "Sentience") == "Oui", "gold": col(r, "Gold") == "Oui",
                 "blackHole": col(r, "Trou noir") == "Oui"},
        "trigger": r.get("Déclenchement", ""), "event": r.get("Événement passif", ""),
        "target": r.get("Cible", ""), "check": r.get("Vérification", ""),
        "text": r["Description"], "rules": r.get("Précisions (règles)", ""), "image": r.get("Image", ""),
    }


cards = {}
for r in rows(wb["Cartes"]):
    c = card(r, "card")
    cards[c["id"]] = c
    by_name[c["deck"]]["cards"].append(c["id"])
for r in rows(wb["Conditions"]):
    c = card(r, "victory")
    cards[c["id"]] = c
    by_name[c["deck"]]["vcs"].append(c["id"])

glossary = []
if "Glossaire" in wb.sheetnames:
    for g in rows(wb["Glossaire"]):
        glossary.append({"term": g.get("Terme", ""), "cat": g.get("Catégorie", ""), "def": g.get("Définition", ""),
                         "example": g.get("Exemple", ""), "anim": g.get("Animation", ""),
                         "words": [w.strip() for w in g.get("Mots reconnus", "").split(",") if w.strip()]})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"decks": decks, "cards": cards, "glossary": glossary}, f, ensure_ascii=False, indent=1)
print(f"{len(cards)} cartes, decks jouables : {[d['name'] for d in decks if d['inGame']]}")
