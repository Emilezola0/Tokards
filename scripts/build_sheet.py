"""Remet en forme le classeur des cartes (prêt pour Google Sheets) et met à jour la colonne « Automatisation ».

Usage : python -I scripts/build_sheet.py [entrée.xlsx] [sortie.xlsx]   (par défaut : data/Tokards_cartes.xlsx)
À relancer après avoir automatisé des cartes, ou sur un classeur téléchargé depuis Google Sheets.
Les noms de colonnes restent ceux que lit scripts/import_cards.py.
"""
import os
import re
import sys

import openpyxl
from openpyxl.cell.rich_text import CellRichText, TextBlock
from openpyxl.cell.text import InlineFont
from openpyxl.formatting.rule import FormulaRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "Tokards_cartes.xlsx")
OUT = sys.argv[2] if len(sys.argv) > 2 else SRC

# Cartes et conditions automatisées dans le jeu (lu dans le code).
def scripted():
    ids = set()
    for f in os.listdir(os.path.join(ROOT, "src", "effects")):
        if f.endswith(".ts"):
            ids |= set(re.findall(r'^  "([A-Z]+-\d+)": ', open(os.path.join(ROOT, "src", "effects", f), encoding="utf-8").read(), re.M))
    v = open(os.path.join(ROOT, "src", "game", "victory.ts"), encoding="utf-8").read()
    ids |= set(re.findall(r'^  "(VC-[A-Z]+-\d+)":', v, re.M))
    return ids

AUTO = scripted()
AUTO_YES, AUTO_NO = "⚙ Automatique", "✋ Manuelle"
MIN_CARDS = 10  # nombre de cartes minimum pour qu'un deck soit jouable (pas de maximum)
# Animations du glossaire illustré (src/ui/Glossary.tsx)
ANIMS = ["gold", "sentience", "blackhole", "resources", "tags", "activate", "passive", "zones", "positions", "draw", "play",
         "discard", "spend", "give", "steal", "swap", "shuffle", "cycle", "remove", "lock", "dice", "bhdice", "target", "team",
         "rich", "interaction", "turn", "round", "percent", "weather", "disable", "under", "sentdice", "random", "neighbours"]
CATS = ["Ressource", "Carte", "Zone", "Action", "Joueur", "Règle"]
# Couleur des mots-clés dans les descriptions (par catégorie du glossaire)
KW_COLOR = {"Action": "B35C00", "Ressource": "7B3FC4", "Carte": "0F6E7A", "Zone": "1B7A43", "Joueur": "1F5FA8", "Règle": "9A3B8C"}

src = openpyxl.load_workbook(SRC)
def table(ws):
    rows = list(ws.iter_rows(values_only=True))
    h = [str(x or "").strip() for x in rows[0]]
    return [dict(zip(h, r)) for r in rows[1:] if r and r[0]]

decks = table(src["Decks"])
cards = table(src["Cartes"])
vcs = table(src["Conditions"])
gloss = table(src["Glossaire"])
interp = table(src["Interprétations"]) if "Interprétations" in src.sheetnames else []
lists = list(src["Listes"].iter_rows(values_only=True))
# Onglet libre « Prompt » (demandes écrites pour Claude) : recopié tel quel.
prompt_rows = list(src["Prompt"].iter_rows(values_only=True)) if "Prompt" in src.sheetnames else []

def get(r, *keys):
    for k in keys:
        for h, v in r.items():
            if h == k or (k in h):
                return "" if v is None else v
    return ""

def clean_rules(t):
    return re.sub(r"\s*\[Automatisée\]\s*$", "", str(t or "")).strip()

# ---------- styles ----------
FONT = "Arial"
INK = "1E1533"
HEAD = PatternFill("solid", fgColor="3B2A6B")
HEAD_FONT = Font(name=FONT, bold=True, color="FFFFFF", size=10)
BODY = Font(name=FONT, size=10, color=INK)
CALC = PatternFill("solid", fgColor="EEEAF7")  # colonnes calculées : ne pas modifier
CALC_FONT = Font(name=FONT, size=10, color="4B3F72", italic=True)
LINE = Side(style="thin", color="D9D3EA")
BOX = Border(bottom=LINE)
TOP = Alignment(vertical="top", wrap_text=True)
TOPC = Alignment(vertical="top", horizontal="center", wrap_text=True)

wb = openpyxl.Workbook()
wb.remove(wb.active)

def sheet(title, headers, widths, tab):
    ws = wb.create_sheet(title)
    ws.sheet_properties.tabColor = tab
    ws.append(headers)
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
        c = ws.cell(row=1, column=i)
        c.fill, c.font = HEAD, HEAD_FONT
        c.alignment = Alignment(vertical="center", horizontal="center", wrap_text=True)
    ws.row_dimensions[1].height = 30
    return ws

def body(ws, n_rows, n_cols, center=(), calc=()):
    for r in range(2, n_rows + 2):
        for c in range(1, n_cols + 1):
            cell = ws.cell(row=r, column=c)
            cell.font = CALC_FONT if c in calc else BODY
            cell.alignment = TOPC if c in center else TOP
            cell.border = BOX
            if c in calc:
                cell.fill = CALC

def dv_list(ws, rng, source, prompt=None):
    dv = DataValidation(type="list", formula1=source, allow_blank=True, showDropDown=False)
    dv.error, dv.errorTitle = "Choisis une valeur de la liste.", "Valeur inconnue"
    dv.showErrorMessage = True
    if prompt:
        dv.prompt, dv.showInputMessage = prompt, True
    ws.add_data_validation(dv)
    dv.add(rng)

def fill_rule(ws, rng, formula, color, font=None):
    ws.conditional_formatting.add(rng, FormulaRule(formula=[formula], fill=PatternFill("solid", fgColor=color), font=font))

# ---------- Listes ----------
L = {
    "OuiNon": ["Oui", "Non"],
    "Déclenchement": ["Activation", "Passif", "Les deux", "Aucun"],
    "Événement passif": [x for x in (r[2] for r in lists[1:]) if x],
    "Cible": [x for x in (r[3] for r in lists[1:]) if x],
    "Vérification": [x for x in (r[4] for r in lists[1:]) if x],
    "Statut": ["À vérifier", "Validé", "À reformuler", "Nouvelle"],
    "Automatisation": [AUTO_YES, AUTO_NO],
    "Catégorie": CATS,
    "Animation": ANIMS,
    "Interprétation": ["À valider", "Validée", "À changer"],
}
li = wb.create_sheet("Listes")
li.sheet_properties.tabColor = "9E9E9E"
REF = {}
for c, (name, vals) in enumerate(L.items(), 1):
    col = get_column_letter(c)
    li.cell(row=1, column=c, value=name).font = HEAD_FONT
    li.cell(row=1, column=c).fill = HEAD
    li.column_dimensions[col].width = 30
    for r, v in enumerate(vals, 2):
        li.cell(row=r, column=c, value=v).font = BODY
    REF[name] = f"=Listes!${col}$2:${col}${len(vals) + 1}"
li.cell(row=1, column=len(L) + 2, value="Ajoute une valeur en bas d'une colonne : elle apparaît dans les menus déroulants.").font = Font(name=FONT, italic=True, size=9, color="6B6290")

# ---------- Decks ----------
dh = ["Deck", "Code", "Dans le jeu", "Couleur", "Description", "Mots-clés", "Résumé du gameplay", "Dos (image)",
      "Nb cartes", "Nb conditions", "Jouable ?", "Cartes automatiques", "À vérifier", "À mettre à jour", "Difficulté"]
dk = sheet("Decks", dh, [24, 9, 11, 11, 40, 34, 50, 16, 10, 12, 26, 13, 11, 13, 12], "7C4DFF")
DIFF_DEFAULT = {"Popo emplois": "Facile", "Empire Goblin": "Moyen", "Dynastie des Grenouilles": "Moyen", "Police": "Moyen",
                "Pirate": "Moyen", "Emile": "Difficile", "Fléaux": "Difficile", "Météo": "Difficile"}
for i, d in enumerate(decks, 2):
    dk.append([d["Deck"], d["Code"], get(d, "Dans le jeu") or "Non", get(d, "Couleur"), get(d, "Description"),
               get(d, "Mots-clés"), get(d, "Résumé du gameplay"), get(d, "Dos (image)")])
    dk[f"I{i}"] = f"=COUNTIF(Cartes!$B:$B,$A{i})"
    dk[f"J{i}"] = f"=COUNTIF(Conditions!$B:$B,$A{i})"
    dk[f"K{i}"] = (f'=IF($A{i}="BASE","— deck commun",IF($I{i}<{MIN_CARDS},"✖ "&({MIN_CARDS}-$I{i})&" carte(s) manquante(s) (min. {MIN_CARDS})",'
                   f'IF($J{i}<1,"✖ Aucune condition",IF($L{i}<$I{i},"🚧 En cours ("&$L{i}&"/"&$I{i}&" automatiques)","✔ Jouable"))))')
    dk[f"L{i}"] = f'=COUNTIFS(Cartes!$B:$B,$A{i},Cartes!$N:$N,"{AUTO_YES}")'
    dk[f"M{i}"] = f'=COUNTIFS(Cartes!$B:$B,$A{i},Cartes!$M:$M,"À vérifier")+COUNTIFS(Conditions!$B:$B,$A{i},Conditions!$K:$K,"À vérifier")'
    dk[f"N{i}"] = f'=COUNTIFS(Cartes!$B:$B,$A{i},Cartes!$O:$O,"Oui")+COUNTIFS(Conditions!$B:$B,$A{i},Conditions!$M:$M,"Oui")'
    dk[f"O{i}"] = get(d, "Difficulté") or DIFF_DEFAULT.get(d["Deck"], "")
nd = len(decks)
body(dk, nd, len(dh), center=(2, 3, 4, 8, 9, 10, 12, 13, 14, 15), calc=(9, 10, 11, 12, 13, 14))
dv_list(dk, "O2:O200", '"Facile,Moyen,Difficile"', "Difficulté affichée sur le deck quand on le choisit.")
fill_rule(dk, "O2:O200", '$O2="Facile"', "D7F5E3", Font(name=FONT, color="1B7A43", bold=True))
fill_rule(dk, "O2:O200", '$O2="Moyen"', "FFF1D6", Font(name=FONT, color="9A5B00", bold=True))
fill_rule(dk, "O2:O200", '$O2="Difficile"', "FDE2E7", Font(name=FONT, color="B3261E", bold=True))
dk.freeze_panes = "B2"
dk.auto_filter.ref = f"A1:{get_column_letter(len(dh))}{nd + 1}"
dv_list(dk, "C2:C200", REF["OuiNon"], f"Oui = le deck peut être choisi. Il faut au moins {MIN_CARDS} cartes, 1 condition, et toutes les cartes automatiques (sinon « En cours » dans le jeu).")
fill_rule(dk, f"K2:K{nd + 1}", 'LEFT($K2,1)="✔"', "D7F5E3", Font(name=FONT, color="1B7A43", bold=True))
fill_rule(dk, f"K2:K{nd + 1}", 'LEFT($K2,1)="✖"', "FDE2E7", Font(name=FONT, color="B3261E"))
fill_rule(dk, f"K2:K{nd + 1}", 'LEFT($K2,2)="🚧"', "FFF1D6", Font(name=FONT, color="9A5B00"))
fill_rule(dk, "C2:C200", '$C2="Oui"', "D7F5E3", Font(name=FONT, color="1B7A43", bold=True))
fill_rule(dk, f"N2:N{nd + 1}", "$N2>0", "FFE7C2", Font(name=FONT, color="9A5B00", bold=True))
fill_rule(dk, f"A2:H{nd + 1}", 'AND($C2="Oui",LEFT($K2,1)="✖")', "FDE2E7")

# ---------- Mots-clés colorés (d'après le glossaire) ----------
def gloss_words():
    out = []
    for g in gloss:
        color = KW_COLOR.get(get(g, "Catégorie"), "B35C00")
        for w in str(get(g, "Mots reconnus") or "").split(","):
            w = w.strip()
            if w:
                out.append((w, color))
    out.sort(key=lambda x: -len(x[0]))
    return out

KW = gloss_words()
KW_RE = re.compile(r"(?<![\w-])(" + "|".join(re.escape(w) for w, _ in KW) + r")(?![\w-])", re.I) if KW else None
KW_COLORS = {w.lower(): c for w, c in KW}

def rich(text):
    """Description avec les mots du glossaire en gras et en couleur."""
    text = str(text or "")
    if not KW_RE or not text:
        return text
    parts, last = [], 0
    for m in KW_RE.finditer(text):
        if m.start() > last:
            parts.append(TextBlock(InlineFont(rFont=FONT, sz=10, color=INK), text[last:m.start()]))
        parts.append(TextBlock(InlineFont(rFont=FONT, sz=10, b=True, color=KW_COLORS.get(m.group(0).lower(), "B35C00")), m.group(0)))
        last = m.end()
    if not parts:
        return text
    if last < len(text):
        parts.append(TextBlock(InlineFont(rFont=FONT, sz=10, color=INK), text[last:]))
    return CellRichText(parts)

# ---------- Cartes ----------
ch = ["ID", "Deck", "Nom", "🧠 Sentience", "💰 Gold", "🌀 Trou noir", "Déclenchement", "Événement passif", "Cible",
      "Description", "Précisions (règles)", "Image", "Statut", "Automatisation", "À mettre à jour", "Notes / changements"]
ca = sheet("Cartes", ch, [10, 18, 26, 10, 9, 10, 13, 20, 18, 60, 55, 14, 12, 15, 11, 36], "FFB300")
for c in cards:
    ca.append([c["ID"], c["Deck"], c["Nom"], get(c, "Sentience") or "Non", get(c, "Gold") or "Non", get(c, "Trou noir") or "Non",
               get(c, "Déclenchement"), get(c, "Événement passif"), get(c, "Cible"), get(c, "Description"),
               clean_rules(get(c, "Précisions")), get(c, "Image"), get(c, "Statut") or "À vérifier",
               AUTO_YES if c["ID"] in AUTO else AUTO_NO, "Non", ""])
nc = len(cards)
body(ca, nc, len(ch), center=(1, 4, 5, 6, 7, 12, 13, 14, 15))
for r in range(2, nc + 2):
    ca.cell(row=r, column=10).value = rich(ca.cell(row=r, column=10).value)
ca.freeze_panes = "D2"
ca.auto_filter.ref = f"A1:{get_column_letter(len(ch))}{nc + 1}"
MAX = 2000
dv_list(ca, f"B2:B{MAX}", f"=Decks!$A$2:$A${nd + 50}", "Le deck doit exister dans l'onglet Decks.")
for col in "DEF":
    dv_list(ca, f"{col}2:{col}{MAX}", REF["OuiNon"])
dv_list(ca, f"G2:G{MAX}", REF["Déclenchement"])
dv_list(ca, f"H2:H{MAX}", REF["Événement passif"], "Seulement pour les cartes Passif.")
dv_list(ca, f"I2:I{MAX}", REF["Cible"])
dv_list(ca, f"M2:M{MAX}", REF["Statut"])
dv_list(ca, f"N2:N{MAX}", REF["Automatisation"], "Rempli par Claude d'après le code du jeu.")
dv_list(ca, f"O2:O{MAX}", REF["OuiNon"], "Mets Oui quand tu modifies la carte : Claude mettra le jeu à jour.")

def common_rules(ws, n, id_col, status_col, auto_col, upd_col, last_col):
    rng = f"A2:{last_col}{MAX}"
    fill_rule(ws, rng, f'${upd_col}2="Oui"', "FFF1D6")
    fill_rule(ws, f"{id_col}2:{id_col}{MAX}", f'AND(${id_col}2<>"",COUNTIF(${id_col}:${id_col},${id_col}2)>1)', "F8C7CF", Font(name=FONT, color="B3261E", bold=True))
    fill_rule(ws, f"{status_col}2:{status_col}{MAX}", f'${status_col}2="Validé"', "D7F5E3", Font(name=FONT, color="1B7A43"))
    fill_rule(ws, f"{status_col}2:{status_col}{MAX}", f'${status_col}2="À reformuler"', "FDE2E7", Font(name=FONT, color="B3261E"))
    fill_rule(ws, f"{status_col}2:{status_col}{MAX}", f'${status_col}2="Nouvelle"', "DCEBFF", Font(name=FONT, color="1F5FA8"))
    fill_rule(ws, f"{auto_col}2:{auto_col}{MAX}", f'${auto_col}2="{AUTO_YES}"', "DDF3F7", Font(name=FONT, color="0F6E7A"))
    fill_rule(ws, f"{upd_col}2:{upd_col}{MAX}", f'${upd_col}2="Oui"', "FFD08A", Font(name=FONT, color="7A4300", bold=True))
    for col in "DEF":
        fill_rule(ws, f"{col}2:{col}{MAX}", f'${col}2="Oui"', "E9E2FF", Font(name=FONT, color="3B2A6B", bold=True))
        fill_rule(ws, f"{col}2:{col}{MAX}", f'${col}2="Non"', "FFFFFF", Font(name=FONT, color="B0A9C6"))

common_rules(ca, nc, "A", "M", "N", "O", "P")
fill_rule(ca, f"G2:G{MAX}", '$G2="Passif"', "E0F7FA", Font(name=FONT, color="0F6E7A", bold=True))

# ---------- Conditions ----------
vh = ["ID", "Deck", "Nom", "🧠 Sentience", "💰 Gold", "🌀 Trou noir", "Vérification", "Description", "Précisions (règles)",
      "Image", "Statut", "Automatisation", "À mettre à jour", "Notes / changements"]
vc = sheet("Conditions", vh, [11, 18, 26, 10, 9, 10, 18, 55, 55, 14, 12, 15, 11, 36], "FF7043")
for c in vcs:
    vc.append([c["ID"], c["Deck"], c["Nom"], get(c, "Sentience") or "Non", get(c, "Gold") or "Non", get(c, "Trou noir") or "Non",
               get(c, "Vérification"), get(c, "Description"), clean_rules(get(c, "Précisions")), get(c, "Image"),
               get(c, "Statut") or "À vérifier", AUTO_YES if c["ID"] in AUTO else AUTO_NO, "Non", ""])
nv = len(vcs)
body(vc, nv, len(vh), center=(1, 4, 5, 6, 10, 11, 12, 13))
for r in range(2, nv + 2):
    vc.cell(row=r, column=8).value = rich(vc.cell(row=r, column=8).value)
vc.freeze_panes = "D2"
vc.auto_filter.ref = f"A1:{get_column_letter(len(vh))}{nv + 1}"
dv_list(vc, f"B2:B{MAX}", f"=Decks!$A$2:$A${nd + 50}")
for col in "DEF":
    dv_list(vc, f"{col}2:{col}{MAX}", REF["OuiNon"])
dv_list(vc, f"G2:G{MAX}", REF["Vérification"])
dv_list(vc, f"K2:K{MAX}", REF["Statut"])
dv_list(vc, f"L2:L{MAX}", REF["Automatisation"])
dv_list(vc, f"M2:M{MAX}", REF["OuiNon"], "Mets Oui quand tu modifies la condition.")
# Mêmes règles, colonnes décalées (Statut K, Automatisation L, À mettre à jour M)
common_rules(vc, nv, "A", "K", "L", "M", "N")

# ---------- Glossaire ----------
KNOWN = {
    "Interaction": "Quand quelqu'un touche au gold, à la sentience, au trou noir, aux cartes (main, terrain, défausse, pioche) d'un joueur. Sans précision, ça veut dire tout. D'un joueur à un autre, et ça marche aussi pour soi-même sauf précision contraire.",
    "Tour de table": "Autant de tours que de joueurs, à partir du moment considéré.",
    "Passif": "Effet qui réagit à un événement tant que la carte est sur un terrain, même pendant le tour des autres.",
    "Cible": "Quand la carte ne précise pas, le lanceur choisit parmi toutes les possibilités, lui compris.",
}
gh = ["Terme", "Catégorie", "Définition", "Exemple", "Mots reconnus", "Animation"]
gl = sheet("Glossaire", gh, [30, 13, 70, 36, 44, 13], "26A69A")
for g in gloss:
    term = get(g, "Terme")
    gl.append([term, get(g, "Catégorie"), get(g, "Définition") or KNOWN.get(term, ""), get(g, "Exemple"), get(g, "Mots reconnus"), get(g, "Animation")])
body(gl, gl.max_row - 1, len(gh), center=(2, 6))
gl.freeze_panes = "B2"
gl.auto_filter.ref = f"A1:F{gl.max_row}"
dv_list(gl, "B2:B500", REF["Catégorie"], "La couleur du mot sur les cartes dépend de la catégorie.")
dv_list(gl, "F2:F500", REF["Animation"], "Illustration animée dans le glossaire du jeu.")
fill_rule(gl, "C2:C500", 'AND($A2<>"",$C2="")', "FFF1D6")
for cat, color in KW_COLOR.items():
    fill_rule(gl, "B2:B500", f'$B2="{cat}"', "FFFFFF", Font(name=FONT, color=color, bold=True))

# ---------- Interprétations ----------
# Les choix faits par Claude quand le texte d'une carte peut se lire de plusieurs façons.
# Les lignes sont conservées d'une mise à jour à l'autre : mets « À changer » et écris ta réponse pour corriger.
ih = ["ID", "Deck", "Carte", "Passage ambigu", "Interprétation choisie", "Statut", "Ta réponse / changement voulu"]
it = sheet("Interprétations", ih, [11, 18, 24, 40, 70, 13, 44], "F5A623")
names = {str(get(c, "ID")): (get(c, "Deck"), get(c, "Nom")) for c in cards + vcs}
for r in interp:
    cid = str(get(r, "ID"))
    deck, name = names.get(cid, (get(r, "Deck"), get(r, "Carte")))
    it.append([cid, deck or get(r, "Deck"), name or get(r, "Carte"), get(r, "Passage ambigu"), get(r, "Interprétation choisie"),
               get(r, "Statut") or "À valider", get(r, "Ta réponse")])
body(it, max(it.max_row - 1, 1), len(ih), center=(1, 6))
it.freeze_panes = "D2"
it.auto_filter.ref = f"A1:G{max(it.max_row, 2)}"
dv_list(it, "F2:F500", REF["Interprétation"], "À valider : pas encore relue. À changer : écris ce qu'il faut dans la dernière colonne.")
fill_rule(it, "F2:F500", '$F2="Validée"', "D7F5E3")
fill_rule(it, "F2:F500", '$F2="À changer"', "FDE2E7")
fill_rule(it, "F2:F500", '$F2="À valider"', "FFF1D6")

# ---------- Lisez-moi ----------
rd = wb.create_sheet("Lisez-moi", 0)
rd.sheet_properties.tabColor = "3B2A6B"
rd.column_dimensions["A"].width = 3
rd.column_dimensions["B"].width = 34
rd.column_dimensions["C"].width = 90
rd.sheet_view.showGridLines = False
row = 2
def line(b, c="", style="text"):
    global row
    cb, cc = rd.cell(row=row, column=2, value=b), rd.cell(row=row, column=3, value=c)
    if style == "title":
        cb.font = Font(name=FONT, size=18, bold=True, color="3B2A6B")
    elif style == "h":
        cb.font = Font(name=FONT, size=12, bold=True, color="FFFFFF")
        cb.fill = cc.fill = HEAD
    elif style == "k":
        cb.font = Font(name=FONT, size=10, bold=True, color=INK)
        cc.font = Font(name=FONT, size=10, color=INK)
    else:
        cb.font = Font(name=FONT, size=10, color=INK)
        cc.font = Font(name=FONT, size=10, color=INK)
    cb.alignment = cc.alignment = Alignment(vertical="top", wrap_text=True)
    row += 1

line("Tokards — base des cartes", style="title")
line("Le jeu lit ce classeur pour construire les cartes. Modifie-le ici, puis envoie-le à Claude pour mettre le jeu à jour.")
row += 1
line("Résumé", "", "h")
line("Cartes", "", "k"); rd[f"C{row - 1}"] = "=COUNTA(Cartes!$A:$A)-1"
line("Conditions de victoire", "", "k"); rd[f"C{row - 1}"] = "=COUNTA(Conditions!$A:$A)-1"
line("Decks jouables", "", "k"); rd[f"C{row - 1}"] = '=COUNTIF(Decks!$C:$C,"Oui")'
line("Decks marqués « Oui » pas encore jouables", "", "k"); rd[f"C{row - 1}"] = '=COUNTIFS(Decks!$C:$C,"Oui",Decks!$K:$K,"<>✔ Jouable")'
line("Cartes automatiques", "", "k"); rd[f"C{row - 1}"] = f'=COUNTIF(Cartes!$N:$N,"{AUTO_YES}")'
line("À mettre à jour dans le jeu", "", "k"); rd[f"C{row - 1}"] = '=COUNTIF(Cartes!$O:$O,"Oui")+COUNTIF(Conditions!$M:$M,"Oui")'
for r in range(row - 6, row):
    rd[f"C{r}"].alignment = Alignment(horizontal="left")
    rd[f"C{r}"].font = Font(name=FONT, size=11, bold=True, color="3B2A6B")
fill_rule(rd, f"C{row - 3}", f"$C${row - 3}>0", "FDE2E7")
fill_rule(rd, f"C{row - 1}", f"$C${row - 1}>0", "FFD08A")
row += 1
line("Mettre à jour le jeu", "", "h")
line("1. Modifie", "Change le texte, les tags, ajoute des cartes… Mets « Oui » dans la colonne « À mettre à jour » des lignes modifiées et explique le changement dans « Notes / changements ».", "k")
line("2. Télécharge", "Dans Google Sheets : Fichier → Télécharger → Microsoft Excel (.xlsx).", "k")
line("3. Envoie à Claude", "Claude met le jeu à jour, automatise les nouvelles cartes si possible, puis remet « À mettre à jour » à Non.", "k")
row += 1
line("Règles à respecter", "", "h")
line("ID", "Ne change jamais l'ID d'une carte existante (le jeu s'en sert). Nouvelle carte : code du deck + numéro suivant (ex. GOB-33, VC-GOB-4). Un ID en double s'affiche en rouge.", "k")
line("Deck jouable", f"Au moins {MIN_CARDS} cartes (pas de maximum), au moins 1 condition de victoire et toutes les cartes automatiques (colonne « Jouable ? »). Sinon le jeu l'affiche « En cours » et on ne peut pas le choisir.", "k")
line("Difficulté", "Facile, Moyen ou Difficile : affichée en étiquette sur le deck dans le salon.", "k")
line("Mots-clés / Résumé / Dos", "Affichés quand on regarde un deck. « Dos (image) » = fichier de l'image du dos de carte (ex. BACK-GOB.webp).", "k")
line("Mots en couleur", "Les mots listés dans « Mots reconnus » du glossaire sont colorés dans les descriptions (ici et dans le jeu). Ajoute une variante pour qu'elle soit reconnue.", "k")
line("Tags", "Oui / Non pour 🧠 Sentience, 💰 Gold, 🌀 Trou noir.", "k")
line("Déclenchement", "Activation : s'applique pendant la phase 1 et quand on pose la carte. Passif : réagit à un événement (colonne « Événement passif »).", "k")
line("Précisions (règles)", "Comment la carte est interprétée dans le jeu. Claude y note ses choix quand le texte peut se lire de plusieurs façons.", "k")
line("Interprétations", "Chaque choix d'interprétation de Claude, à relire. Mets « Validée » si c'est bon, ou « À changer » avec ta réponse dans la dernière colonne, puis envoie le classeur à Claude.", "k")
line("Image", "Nom du fichier image de la carte (ex. GOB-01.png). Envoie les nouvelles images avec le classeur.", "k")
row += 1
line("Légende des couleurs", "", "h")
legend = [
    ("Cellule blanche", "À remplir ou modifier librement.", "FFFFFF"),
    ("Colonne grisée (italique)", "Calculée automatiquement : ne pas modifier.", "EEEAF7"),
    ("Ligne orange", "Marquée « À mettre à jour » : modification à reporter dans le jeu.", "FFF1D6"),
    ("Rouge", "Problème : ID en double, deck jouable incomplet, statut « À reformuler ».", "FDE2E7"),
    ("Vert", "Validé / complet.", "D7F5E3"),
    ("Bleu clair", "⚙ Automatique dans le jeu, ou carte Passif.", "DDF3F7"),
]
for name, desc, color in legend:
    line(name, desc, "k")
    rd[f"B{row - 1}"].fill = PatternFill("solid", fgColor=color)
    rd[f"B{row - 1}"].border = Border(left=LINE, right=LINE, top=LINE, bottom=LINE)
row += 1
line("Onglets", "", "h")
for name, desc in [("Decks", "Un deck par ligne, avec les compteurs et la vérification « Jouable ? »."),
                   ("Cartes", f"Une carte par ligne (au moins {MIN_CARDS} par deck)."),
                   ("Conditions", "Les conditions de victoire, une par ligne."),
                   ("Glossaire", "Le sens des mots des cartes, leur catégorie (couleur), les variantes reconnues et l'animation du glossaire du jeu."),
                   ("Interprétations", "Les choix faits quand un texte de carte est ambigu : à valider ou à corriger."),
                   ("Listes", "Les valeurs des menus déroulants. Ajoute une valeur en bas d'une colonne pour la proposer.")]:
    line(name, desc, "k")

if prompt_rows:
    pr = wb.create_sheet("Prompt")
    for r in prompt_rows:
        pr.append(list(r))
    pr.column_dimensions["A"].width = 140
    for row in pr.iter_rows():
        for c in row:
            c.alignment = Alignment(wrap_text=True, vertical="top")
            c.font = Font(name=FONT, size=10)
wb.move_sheet("Listes", offset=len(wb.sheetnames) - 1 - wb.sheetnames.index("Listes"))
wb.active = 0
wb.save(OUT)
print(f"OK {OUT} : {nd} decks, {nc} cartes, {nv} conditions, {len(AUTO)} automatisées")
