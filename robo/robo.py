#!/usr/bin/env python3
"""
Robô de provas anteriores — Método Camocim Concursos

Baixa o caderno de provas e o gabarito DEFINITIVO no site oficial da banca,
separa as questões (Certo/Errado ou múltipla escolha), aplica o gabarito,
tira as anuladas e grava um JSON pronto para "Ajustes → Importar questões".
Com --comentar e a variável ANTHROPIC_API_KEY, escreve comentário, fundamento,
disciplina e assunto de cada questão com a IA (para revisão antes de publicar).

Exemplos
  python robo.py listar --pagina "https://www.cebraspe.org.br/concursos/sefaz_ce_21"
  python robo.py converter --prova prova.pdf --gabarito gab1.pdf --gabarito gab2.pdf \
      --banca Cebraspe --ano 2021 --orgao SEFAZ-CE --cargo "Auditor-Fiscal" --comentar
"""
import argparse, io, json, os, re, sys, time, unicodedata
from collections import Counter
from datetime import datetime
from urllib.parse import urljoin, urlparse

try:
    import pdfplumber
except ImportError:
    sys.exit("Falta a biblioteca pdfplumber. Rode: pip install -r requirements.txt")

UA = {"User-Agent": "Mozilla/5.0 (robo-provas Metodo Camocim; uso educacional)"}
ANULADO = "X"

# --------------------------------------------------------------------- utilidades
def log(*a):
    print(*a, file=sys.stderr, flush=True)

def norm(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")[:80] or "prova"

def baixar(fonte, pasta):
    """Aceita caminho local ou URL http(s). Devolve o caminho local do PDF."""
    if not re.match(r"^https?://", fonte):
        if not os.path.exists(fonte):
            raise SystemExit(f"Arquivo não encontrado: {fonte}")
        return fonte
    import requests
    os.makedirs(pasta, exist_ok=True)
    nome = os.path.basename(urlparse(fonte).path) or "arquivo.pdf"
    destino = os.path.join(pasta, nome)
    log(f"Baixando {fonte}")
    r = requests.get(fonte, headers=UA, timeout=90)
    r.raise_for_status()
    if not r.content.startswith(b"%PDF"):
        raise SystemExit(f"O endereço não devolveu um PDF: {fonte}")
    with open(destino, "wb") as f:
        f.write(r.content)
    time.sleep(1)  # educação com o servidor da banca
    return destino

# --------------------------------------------------------------------- listar PDFs de uma página
TIPOS = [
    ("gabarito_definitivo", r"gab.*defin|defin.*gab|gabarito.*oficial.*defin"),
    ("gabarito_preliminar", r"gab.*prel|prel.*gab|gabarito"),
    ("prova", r"matriz|caderno|prova|tipo[ _-]?\d|cad[ _-]"),
]

def classificar(texto):
    t = norm(texto)
    if re.search(r"disc|discursiva|redac|resultado|edital|^ed[ _]|convoca|impugna|recurso|justificativa|curriculo", t):
        return "outro"
    for tipo, rx in TIPOS:
        if re.search(rx, t):
            return tipo
    return "outro"

def listar(pagina, filtro=""):
    import requests
    from bs4 import BeautifulSoup
    r = requests.get(pagina, headers=UA, timeout=60)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    vistos, saida = set(), []
    for a in soup.find_all("a", href=True):
        url = urljoin(pagina, a["href"])
        if not re.search(r"\.pdf(\?|$)", url, re.I) or url in vistos:
            continue
        vistos.add(url)
        texto = " ".join(a.get_text(" ").split()) or os.path.basename(urlparse(url).path)
        if filtro and norm(filtro) not in norm(texto + " " + url):
            continue
        saida.append({"tipo": classificar(texto + " " + os.path.basename(url)), "texto": texto, "url": url})
    if not saida:
        log("Nenhum PDF encontrado nessa página. Alguns sites montam a lista com JavaScript;"
            " nesse caso, copie os links dos PDFs (botão direito → Copiar endereço do link) e use o comando converter.")
    return saida

# --------------------------------------------------------------------- leitura do PDF
def linhas_pdf(caminho):
    """Lê o PDF e devolve as linhas em ordem de leitura, respeitando duas colunas.
    Cada linha: {"t": texto, "x": recuo em pontos a partir da margem da coluna, "pag": n}"""
    saida = []
    with pdfplumber.open(caminho) as pdf:
        for np_, pg in enumerate(pdf.pages, 1):
            W, H = pg.width, pg.height
            ws = pg.extract_words(keep_blank_chars=False, use_text_flow=False, x_tolerance=1.5, y_tolerance=3)
            ws = [w for w in ws if H * 0.035 < w["top"] < H * 0.965]  # corta cabeçalho/rodapé extremos
            if not ws:
                continue
            meio = W / 2
            cruzam = sum(len(w["text"]) for w in ws if w["x0"] < meio - 8 and w["x1"] > meio + 8)
            total = sum(len(w["text"]) for w in ws) or 1
            esq = [w for w in ws if w["x1"] <= meio + 8]
            dir_ = [w for w in ws if w["x0"] >= meio - 8]
            duas = cruzam < total * 0.08 and len(esq) > 20 and len(dir_) > 20
            if duas:
                # faixas largas (título, instruções) que cruzam o meio ficam antes das colunas
                cruz = [w for w in ws if w["x0"] < meio - 8 and w["x1"] > meio + 8]
                lim = max((w["bottom"] for w in cruz), default=0) if cruz and min(w["top"] for w in cruz) < H * 0.35 else 0
                topo = [w for w in ws if w["bottom"] <= lim + 1]
                resto = [w for w in ws if w["bottom"] > lim + 1]
                grupos = [topo, [w for w in resto if (w["x0"] + w["x1"]) / 2 < meio], [w for w in resto if (w["x0"] + w["x1"]) / 2 >= meio]]
            else:
                grupos = [ws]
            for g in grupos:
                if not g:
                    continue
                g.sort(key=lambda w: (round(w["top"]), w["x0"]))
                linhas, atual, ytop, ybot = [], [], None, None
                for w in g:
                    # mesma linha: topo próximo, ou palavra pequena (índice/expoente) dentro da altura da linha
                    mesma = ytop is not None and (abs(w["top"] - ytop) <= 3.5 or (w["top"] < ybot - 1 and w["bottom"] <= ybot + 4 and (w["bottom"] - w["top"]) < (ybot - ytop) * 0.85))
                    if ytop is not None and not mesma:
                        linhas.append(atual); atual = []
                    if not atual:
                        ytop, ybot = w["top"], w["bottom"]
                    atual.append(w)
                if atual:
                    linhas.append(atual)
                margem = min(min(w["x0"] for w in l) for l in linhas)
                for l in linhas:
                    l.sort(key=lambda w: w["x0"])
                    txt, fim = "", None
                    for w in l:
                        if fim is not None and w["x0"] - fim > 0.8:
                            txt += " "
                        txt += w["text"]; fim = w["x1"]
                    saida.append({"t": re.sub(r"\s+", " ", txt).strip(), "x": round(l[0]["x0"] - margem, 1), "pag": np_})
    return saida

LIXO = re.compile(r"cebraspe\s*\|\s*\w|^espa[çc]o livre$|^rascunho$|folha de rascunho|cebraspe trabalha|^p[áa]gina\s*\d+|^caderno de prova|"
                  r"fgv conhecimento$|funda[çc][ãa]o carlos chagas|^www\.|^\W{0,3}$|^tipo\s+\w+\s*[–-]\s*p[áa]gina", re.I)

def limpar(linhas):
    """Remove cabeçalhos/rodapés (linhas nas bordas da página que se repetem em muitas páginas) e lixo conhecido."""
    paginas = max((l["pag"] for l in linhas), default=1)
    chave = lambda t: re.sub(r"[\d\s]+", "", t.lower())
    por_pag = {p: [l for l in linhas if l["pag"] == p] for p in range(1, paginas + 1)}
    borda = set()
    freq = Counter()
    for p, ls in por_pag.items():
        b = ls[:3] + ls[-3:]
        borda.update(id(l) for l in b)
        freq.update({chave(l["t"]) for l in b if len(chave(l["t"])) > 3})
    lim = max(3, paginas * 0.4) if paginas >= 4 else 10 ** 9
    return [l for l in linhas if not LIXO.search(l["t"])
            and not (id(l) in borda and freq[chave(l["t"])] >= lim and len(l["t"]) < 90)]

def juntar(partes):
    t = ""
    for p in partes:
        if not t:
            t = p; continue
        if re.search(r"[a-zà-ú]-$", t) and re.match(r"[a-zà-ú]", p):
            t = t[:-1] + p
        else:
            quebra = re.match(r"^(?:[IVX]{1,5}|[a-e])[\s\.\)–-]\s*\S", p) and re.search(r"[:;.]$", t) or re.match(r"^[•●▪]\s", p)
            t += ("\n" if quebra else " ") + p
    return re.sub(r"[ \t]+", " ", t).strip()

# --------------------------------------------------------------------- questões Certo/Errado (Cebraspe)
def parse_ce(linhas):
    """Itens numerados em sequência; o texto que vem antes de um grupo de itens
    (comando "julgue os itens", texto-base, situação hipotética) é o contexto do grupo."""
    # recorta a partir do primeiro comando de itens (pula a capa e as instruções)
    ini = next((i for i, l in enumerate(linhas) if re.search(r"\bjulgue\b|^\s*1\s+\S", l["t"], re.I)
                and not re.search(r"marque|folha de respostas|campo designado", l["t"], re.I)), 0)
    while ini > 0 and linhas[ini - 1]["x"] <= 1 and not re.search(r"folha de respostas|instru|rascunho|•", linhas[ini - 1]["t"], re.I):
        ini -= 1
    linhas = [l for l in linhas[ini:] if not re.match(r"^-+\s*conhecimentos", l["t"], re.I) and not re.match(r"^os espec[ií]ficos\s*-*$", l["t"], re.I)]
    itens, ctxs, cur, esperado = [], [], None, 1
    recuo_item = None
    for l in linhas:
        t, x = l["t"], l["x"]
        m = re.match(r"^(\d{1,3})\s+(\S.*)$", t)
        if m and int(m.group(1)) == esperado and x <= 3:
            cur = {"n": esperado, "txt": [m.group(2)], "ctx": len(ctxs) - 1}
            itens.append(cur); esperado += 1
            continue
        if cur is not None:
            if recuo_item is None and x > 6:
                recuo_item = x
            if recuo_item is not None and abs(x - recuo_item) <= 4:
                cur["txt"].append(t); continue
        if cur is not None or not ctxs:
            ctxs.append([]); cur = None
        ctxs[-1].append(t)
    for it in itens:
        it["ctx"] = max(it["ctx"], 0) if ctxs else -1
    out = []
    for it in itens:
        c = juntar(ctxs[it["ctx"]]) if it["ctx"] >= 0 else ""
        out.append({"n": it["n"], "tipo": "CE", "contexto": c, "item": juntar(it["txt"]), "alternativas": []})
    return out

# --------------------------------------------------------------------- questões de múltipla escolha (FGV, FCC, Vunesp...)
ALT = re.compile(r"^\(\s*([A-Ea-e])\s*\)\s*(.*)$|^([A-Ea-e])\s*\)\s*(.*)$|^([A-E])\s*[\.\-–]\s+(.*)$")

def parse_me(linhas, n_alt=5):
    L = "ABCDE"[:n_alt]
    textos = [l["t"] for l in linhas]
    qs, q, alt, pend, disc, ctxs, esperado = [], None, -1, [], "", [], 1
    RANGE = re.compile(r"quest[õo]es\s+(?:de\s+n[úu]meros\s+)?(\d{1,3})\s+(?:a|até)\s+(\d{1,3})", re.I)
    titulo = lambda s: len(s) < 70 and not re.search(r"[.;,:]$", s) and re.match(r"^[A-ZÀ-Ú]", s) and not ALT.match(s) and re.search(r"[A-Za-zÀ-ú]{4}", s)

    def q_inicio(s, n):
        m = re.match(r"^quest[ãa]o\s*(\d{1,3})\b[\s:.\-–]*(.*)$", s, re.I)
        if m and int(m.group(1)) == n:
            return m.group(2)
        m = re.match(r"^(\d{1,3})\s*[\.\)\-–]\s*(.*)$", s)
        if m and int(m.group(1)) == n and (m.group(2) == "" or not re.match(r"[a-zà-ú]", m.group(2))):
            return m.group(2)
        return None

    def fecha_pend():
        nonlocal pend, disc
        if not pend:
            return
        k = len(pend)
        while k > 0 and len(pend) - k < 2 and titulo(pend[k - 1]):
            k -= 1
        corpo, tit = pend[:k], pend[k:]
        if tit and (q is None or alt >= n_alt - 2):
            d = [x for x in tit if not re.match(r"^conhecimentos\b", x, re.I)] or tit
            disc = re.sub(r"^[^A-Za-zÀ-ú]+", "", d[-1])
        else:
            corpo += tit
        if q is not None and corpo:
            (q["alts"][alt] if alt >= 0 else q["enun"]).extend(corpo)
        pend = []

    i = 0
    while i < len(textos):
        s = textos[i]
        pronta = q is None or alt >= n_alt - 2
        if pronta and re.match(r"^(aten[çc][ãa]o|leia|texto|as quest[õo]es)", s, re.I) and RANGE.search(" ".join(textos[i:i + 3])):
            fecha_pend()
            bl = [s]
            while i + 1 < len(textos) and q_inicio(textos[i + 1], esperado) is None and not re.match(r"^\d{1,3}$", textos[i + 1]):
                i += 1; bl.append(textos[i])
            m = RANGE.search(" ".join(bl))
            ctxs.append({"de": int(m.group(1)), "ate": int(m.group(2)), "texto": juntar(bl)})
            i += 1; continue
        if re.match(r"^\d{1,4}$", s):  # número sozinho na linha (padrão FGV) ou número de página
            v = int(s)
            if pronta and v == esperado:
                fecha_pend()
                q = {"n": v, "enun": [], "alts": [[] for _ in L], "disc": disc}
                qs.append(q); alt = -1; esperado += 1
            i += 1; continue
        r = q_inicio(s, esperado) if pronta else None
        if r is not None:
            fecha_pend()
            q = {"n": esperado, "enun": [r] if r else [], "alts": [[] for _ in L], "disc": disc}
            qs.append(q); alt = -1; esperado += 1
            i += 1; continue
        if q is None:
            pend.append(s); pend[:] = pend[-6:]; i += 1; continue
        m = ALT.match(s)
        if m and alt < n_alt - 1:
            letra = (m.group(1) or m.group(3) or m.group(5)).upper()
            resto = m.group(2) if m.group(1) else (m.group(4) if m.group(3) else m.group(6))
            k = L.find(letra)
            if k > alt:
                if pend:
                    (q["alts"][alt] if alt >= 0 else q["enun"]).extend(pend); pend = []
                alt = k
                if resto:
                    q["alts"][alt].append(resto)
                i += 1; continue
        if alt >= n_alt - 1:
            pend.append(s)
        elif alt >= 0:
            q["alts"][alt].append(s)
        else:
            q["enun"].append(s)
        i += 1
    if q is not None:
        while pend and titulo(pend[-1]):
            pend.pop()
        (q["alts"][alt] if alt >= 0 else q["enun"]).extend(pend)
    out = []
    for x in qs:
        ctx = "\n".join(c["texto"] for c in ctxs if c["de"] <= x["n"] <= c["ate"])
        out.append({"n": x["n"], "tipo": "ME", "contexto": ctx, "item": juntar(x["enun"]),
                    "alternativas": [juntar(a) for a in x["alts"]], "disciplina_pdf": x["disc"]})
    return out

def detectar_tipo(linhas):
    texto = "\n".join(l["t"] for l in linhas[:400])
    alts = len(re.findall(r"^\(?[A-E]\)", texto, re.M))
    ce = len(re.findall(r"julgue|certo|errado|C ou E", texto, re.I))
    return "ME" if alts >= 15 and alts > ce * 2 else "CE"

# --------------------------------------------------------------------- gabarito
def parse_gabarito(caminho):
    """Lê tabelas "Item / Gabarito" (Cebraspe, FGV) e listas "1 - A" (FCC, Vunesp).
    Devolve {numero: resposta}, com "X" para anulada."""
    with pdfplumber.open(caminho) as pdf:
        texto = "\n".join((p.extract_text(layout=True) or "") for p in pdf.pages)
    ls = [l.strip() for l in texto.split("\n")]
    g = {}
    resp = r"^(?:[A-E]|C|E|X|\*|NULA|ANULADA|ANULADO)$"
    for i in range(len(ls) - 1):
        a, b = ls[i].split(), ls[i + 1].split()
        if a and re.match(r"^(item|quest[ãa]o|quest)", a[0], re.I):
            a = a[1:]
        if b and re.match(r"^(gabarito|resp|resposta)", b[0], re.I):
            b = b[1:]
        if len(a) >= 5 and all(re.match(r"^\d{1,3}$", x) for x in a) and len(b) == len(a) and all(re.match(resp, x, re.I) for x in b):
            for n, r in zip(a, b):
                g[int(n)] = "X" if re.match(r"^(X|\*|NULA|ANULAD)", r, re.I) else r.upper()
    if len(g) >= 5:
        return g
    for n, r in re.findall(r"(?<![\d/.,])(\d{1,3})\s*[-–.:)=]?\s*(ANULAD[AO]|NULA|[A-E]|\*|X)(?![a-zà-ú])", texto, re.I):
        g.setdefault(int(n), "X" if re.match(r"^(X|\*|NULA|ANULAD)", r, re.I) else r.upper())
    return g

# --------------------------------------------------------------------- IA: comentários, disciplina e assunto
def comentar(questoes, banca, modelo, lote=8):
    import requests
    chave = os.environ.get("ANTHROPIC_API_KEY")
    if not chave:
        log("ANTHROPIC_API_KEY não definida: pulando comentários.")
        return 0
    feitas = 0
    for k in range(0, len(questoes), lote):
        grupo = questoes[k:k + lote]
        pedido = []
        for q in grupo:
            gab = ("Certo" if q["gabarito"] == "C" else "Errado") if q["tipo"] == "CE" else "ABCDE"[int(q["gabarito"])]
            alts = "\n".join(f"({'ABCDE'[i]}) {a}" for i, a in enumerate(q.get("alternativas") or []))
            pedido.append(f"### Item {q['_n']}\n{q['enunciado']}\n{alts}\nGABARITO OFICIAL: {gab}")
        prompt = (
            f"Você é professor de concursos públicos. Abaixo há questões da banca {banca} com o GABARITO OFICIAL DEFINITIVO. "
            "Para cada uma, explique em 2 a 4 frases, em português claro, por que o gabarito oficial é o correto. "
            "Nunca contradiga o gabarito oficial. Cite o dispositivo legal, súmula ou teoria só quando tiver certeza; se não tiver, "
            "escreva o tema sem número de artigo. Dê também a disciplina (nome usual de edital) e o assunto (curto).\n"
            "Responda SOMENTE com um JSON: lista de objetos {\"item\": número, \"comentario\": \"...\", \"fundamento\": \"...\", "
            "\"disciplina\": \"...\", \"assunto\": \"...\"}.\n\n" + "\n\n".join(pedido))
        for tentativa in range(3):
            try:
                r = requests.post(os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com").rstrip("/") + "/v1/messages", timeout=180, headers={
                    "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                    json={"model": modelo, "max_tokens": 4000, "messages": [{"role": "user", "content": prompt}]})
                if r.status_code in (429, 500, 502, 503, 529):
                    time.sleep(15 * (tentativa + 1)); continue
                r.raise_for_status()
                txt = "".join(b.get("text", "") for b in r.json().get("content", []))
                arr = json.loads(txt[txt.index("["): txt.rindex("]") + 1])
                por_n = {int(x["item"]): x for x in arr if "item" in x}
                for q in grupo:
                    x = por_n.get(q["_n"])
                    if not x:
                        continue
                    gtxt = ("Certo" if q["gabarito"] == "C" else "Errado") if q["tipo"] == "CE" else "letra " + "ABCDE"[int(q["gabarito"])]
                    q["comentario"] = f"Gabarito oficial: {gtxt}. " + str(x.get("comentario", "")).strip()
                    q["fundamento"] = str(x.get("fundamento", "")).strip()
                    if not q.get("disciplina"):
                        q["disciplina"] = str(x.get("disciplina", "")).strip()
                    q["assunto"] = str(x.get("assunto", "")).strip() or q.get("assunto", "")
                    q["_ia"] = True
                    feitas += 1
                break
            except Exception as e:
                log(f"Comentários do lote {k // lote + 1}: tentativa {tentativa + 1} falhou ({e}).")
                time.sleep(10)
        log(f"Comentados {feitas} de {len(questoes)}")
    return feitas

# --------------------------------------------------------------------- montagem final
SUSPEITO = re.compile(r"\(cid:\d+\)|[\u0B80-\u0DFF\uE000-\uF8FF\uFFFD]|\s{2,}[=\u2212+]\s{2,}")
FIGURA = re.compile(r"\bfigura\b|\bgr[áa]fico\b|\bimagem\b|quadro (?:a seguir|acima|anterior)|tabela (?:a seguir|acima|anterior)|figura precedente", re.I)

def converter(a):
    pasta_dl = os.path.join(a.saida_dir, "_baixados")
    provas = [baixar(p, pasta_dl) for p in a.prova]
    gabs = [baixar(g, pasta_dl) for g in a.gabarito]
    linhas = []
    for p in provas:
        linhas += limpar(linhas_pdf(p))
    tipo = a.tipo if a.tipo != "auto" else detectar_tipo(linhas)
    log(f"Tipo de prova: {'Certo/Errado' if tipo == 'CE' else 'múltipla escolha'}")
    brutas = parse_ce(linhas) if tipo == "CE" else parse_me(linhas, a.alternativas)
    gab = {}
    for g in gabs:
        for n, r in parse_gabarito(g).items():
            gab.setdefault(n, r)
    rel = {"anuladas": [], "sem_gabarito": [], "gabarito_invalido": [], "suspeitas": [], "figuras": [], "faltando": []}
    nums = [q["n"] for q in brutas]
    if nums:
        rel["faltando"] = sorted(set(range(1, max(nums) + 1)) - set(nums))
    out = []
    for q in brutas:
        n, g = q["n"], gab.get(q["n"])
        if g == ANULADO:
            rel["anuladas"].append(n); continue
        if g is None:
            rel["sem_gabarito"].append(n); continue
        if tipo == "CE":
            if g not in ("C", "E"):
                rel["gabarito_invalido"].append(n); continue
            gabarito = g
        else:
            if g not in "ABCDE"[:a.alternativas] or any(not x for x in q["alternativas"]):
                rel["gabarito_invalido"].append(n); continue
            gabarito = "ABCDE".index(g)
        ctx = q["contexto"].replace("\n\n", "\n").strip()
        enun = (ctx + "\n\n" + q["item"]) if ctx else q["item"]
        if SUSPEITO.search(enun + " ".join(q["alternativas"])):
            rel["suspeitas"].append(n)
        if FIGURA.search(enun):
            rel["figuras"].append(n)
        out.append({"tipo": tipo, "enunciado": enun, **({"alternativas": q["alternativas"]} if tipo == "ME" else {}),
                    "gabarito": gabarito, "comentario": "", "fundamento": "",
                    "disciplina": q.get("disciplina_pdf", "") or a.disciplina, "assunto": "",
                    "banca": a.banca, "ano": str(a.ano), "orgao": a.orgao, "cargo": a.cargo,
                    "origem": "concurso", "dificuldade": "media", "_n": n})
    ia = 0
    if a.comentar and out:
        ia = comentar(out, a.banca, a.modelo)
    for q in out:
        if not q["comentario"]:
            gt = ("Certo" if q["gabarito"] == "C" else "Errado") if tipo == "CE" else "letra " + "ABCDE"[q["gabarito"]]
            q["comentario"] = f"Gabarito oficial: {gt} (item {q['_n']} da prova)."
    nome = a.nome or slug(f"{a.banca}-{a.ano}-{a.orgao}-{a.cargo}")
    os.makedirs(a.saida_dir, exist_ok=True)
    arq_json = os.path.join(a.saida_dir, nome + ".json")
    limpo = [{k: v for k, v in q.items() if not k.startswith("_")} for q in out]
    with open(arq_json, "w", encoding="utf-8") as f:
        json.dump(limpo, f, ensure_ascii=False, indent=1)
    md = [f"# Relatório do robô — {a.banca} {a.ano} {a.orgao} — {a.cargo}", "",
          f"Gerado em {datetime.now():%d/%m/%Y %H:%M}. Tipo: {'Certo/Errado' if tipo == 'CE' else 'múltipla escolha'}.", "",
          "| | Quantidade |", "|---|---|",
          f"| Itens lidos na prova | {len(brutas)} |", f"| Itens no gabarito | {len(gab)} |",
          f"| Questões prontas no JSON | {len(out)} |", f"| Anuladas (fora do JSON) | {len(rel['anuladas'])} |",
          f"| Comentadas pela IA | {ia} |", ""]
    avisos = [("Anuladas", "anuladas", "ficaram fora, como deve ser."),
              ("Números que não foram encontrados na prova", "faltando", "confira no PDF e cadastre à mão se precisar."),
              ("Sem resposta no gabarito", "sem_gabarito", "confira se mandou todos os gabaritos (básicos e específicos)."),
              ("Gabarito incompatível ou alternativas incompletas", "gabarito_invalido", "ficaram fora; confira no PDF."),
              ("Com fórmula ou símbolo mal lido", "suspeitas", "revise o enunciado antes de importar."),
              ("Dependem de figura, gráfico ou tabela", "figuras", "o app não mostra imagens: descreva a figura no enunciado.")]
    for titulo, k, dica in avisos:
        if rel[k]:
            md.append(f"**{titulo}** ({len(rel[k])}): {', '.join(map(str, rel[k]))} — {dica}")
            md.append("")
    if ia:
        md += ["**Comentários escritos pela IA:** revise antes de vender, principalmente os de legislação estadual e os que citam artigo de lei.", ""]
    md += ["## Como importar", "No Camocim, entre como administrador → Ajustes → Importar questões → Escolher arquivo .json → marque Banco geral → Importar."]
    with open(os.path.join(a.saida_dir, nome + ".relatorio.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    print(json.dumps({"json": arq_json, "questoes": len(out), "lidas": len(brutas), "anuladas": len(rel["anuladas"]),
                      "sem_gabarito": len(rel["sem_gabarito"]), "suspeitas": rel["suspeitas"], "figuras": rel["figuras"], "comentadas_ia": ia},
                     ensure_ascii=False))
    return out, rel

# --------------------------------------------------------------------- linha de comando
def main():
    ap = argparse.ArgumentParser(description="Robô de provas anteriores — Método Camocim")
    sub = ap.add_subparsers(dest="cmd", required=True)
    l = sub.add_parser("listar", help="lista os PDFs (provas e gabaritos) de uma página de concurso da banca")
    l.add_argument("--pagina", required=True)
    l.add_argument("--filtro", default="", help="parte do nome do arquivo, ex.: 001 ou auditor")
    c = sub.add_parser("converter", help="converte prova + gabarito em JSON do Camocim")
    c.add_argument("--prova", action="append", required=True, help="URL ou caminho do caderno (pode repetir)")
    c.add_argument("--gabarito", action="append", required=True, help="URL ou caminho do gabarito definitivo (pode repetir)")
    c.add_argument("--banca", required=True)
    c.add_argument("--ano", required=True)
    c.add_argument("--orgao", required=True)
    c.add_argument("--cargo", required=True)
    c.add_argument("--tipo", choices=["auto", "CE", "ME"], default="auto")
    c.add_argument("--alternativas", type=int, default=5, help="número de alternativas na múltipla escolha (4 ou 5)")
    c.add_argument("--disciplina", default="", help="disciplina padrão, se a prova não tiver títulos")
    c.add_argument("--comentar", action="store_true", help="escreve comentários com a IA (precisa de ANTHROPIC_API_KEY)")
    c.add_argument("--modelo", default=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"))
    c.add_argument("--nome", default="", help="nome do arquivo de saída (sem .json)")
    c.add_argument("--saida-dir", dest="saida_dir", default="questoes/pendentes")
    a = ap.parse_args()
    if a.cmd == "listar":
        for x in listar(a.pagina, a.filtro):
            print(f"{x['tipo']:<20} {x['texto'][:60]:<60} {x['url']}")
    else:
        converter(a)

if __name__ == "__main__":
    main()
