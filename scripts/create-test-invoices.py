"""Generate fictional PDF fixtures. Optional development tool, never used by the pipeline.

Requirements: reportlab, Pillow, pypdf, and pdftoppm (Poppler) on PATH.
Usage: python scripts/create-test-invoices.py
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from decimal import Decimal
from pathlib import Path
from xml.sax.saxutils import escape

from PIL import Image, ImageEnhance, ImageFilter
from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "output" / "pdf" / "factures-synthetiques"
CASES = json.loads((ROOT / "examples" / "synthetic-cases.json").read_text(encoding="utf-8"))["cases"]
WIDTH, HEIGHT = A4
LEFT, RIGHT = 20 * mm, WIDTH - 20 * mm
FONT, BOLD = "Helvetica", "Helvetica-Bold"

# Use a Unicode font where available; standard PDF Helvetica also supports these French fixtures.
for regular, bold in [
    (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf")),
    (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
]:
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("FixtureSans", str(regular)))
        pdfmetrics.registerFont(TTFont("FixtureBold", str(bold)))
        FONT, BOLD = "FixtureSans", "FixtureBold"
        break

def number(value: float | None, decimals: int = 2) -> str:
    if value is None:
        return "Non indiquée"
    return f"{Decimal(str(value)):,.{decimals}f}".replace(",", " ").replace(".", ",")

def quantity(value: float | None) -> str:
    return "Non indiquée" if value is None else str(value).replace(".", ",")

def date(value: str | None) -> str:
    return "Non indiquée" if value is None else "/".join(reversed(value.split("-")))

def styles(accent: colors.Color):
    base = getSampleStyleSheet()["BodyText"]
    return {
        "body": ParagraphStyle("body", parent=base, fontName=FONT, fontSize=10, leading=14, textColor=colors.HexColor("#24323C")),
        "small": ParagraphStyle("small", parent=base, fontName=FONT, fontSize=9, leading=13),
        "table": ParagraphStyle("table", parent=base, fontName=FONT, fontSize=10, leading=14),
        "number": ParagraphStyle("number", parent=base, fontName=FONT, fontSize=10, leading=14, alignment=TA_RIGHT),
        "head": ParagraphStyle("head", parent=base, fontName=BOLD, fontSize=9, leading=12, textColor=colors.white),
        "total": ParagraphStyle("total", parent=base, fontName=BOLD, fontSize=12, leading=17, textColor=accent),
    }

def para(canvas: Canvas, text: str, x: float, top: float, width: float, style: ParagraphStyle) -> float:
    block = Paragraph(escape(text), style)
    _, height = block.wrap(width, HEIGHT)
    block.drawOn(canvas, x, top - height)
    return top - height

def table(canvas: Canvas, data, widths, top: float, style: TableStyle) -> float:
    block = Table(data, colWidths=widths)
    block.setStyle(style)
    _, height = block.wrap(RIGHT - LEFT, HEIGHT)
    if top - height < 35 * mm:
        raise ValueError("Fixture table does not fit on page")
    block.drawOn(canvas, LEFT, top - height)
    return top - height

def render_page(canvas: Canvas, case: dict, items: list, page: int, page_count: int, item_offset: int):
    inv, layout = case["invoice"], case["layout"]
    accent = colors.HexColor("#17624F" if layout["style"] == "green" else "#245378")
    s = styles(accent)
    canvas.setFillColor(accent)
    canvas.rect(0, HEIGHT - 11 * mm, WIDTH, 11 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont(BOLD, 9)
    canvas.drawString(LEFT, HEIGHT - 7 * mm, "SPECIMEN - FACTURE FICTIVE - TEST TECHNIQUE")
    canvas.setFillColor(accent)
    canvas.setFont(BOLD, 21)
    canvas.drawString(LEFT, HEIGHT - 29 * mm, "FACTURE" if page == 1 else "FACTURE - SUITE")
    top = para(canvas, inv["supplier"], LEFT, HEIGHT - 38 * mm, RIGHT - LEFT, s["total"])
    top = para(canvas, "Fournisseur fictif - aucune prestation réelle", LEFT, top - 7, RIGHT - LEFT, s["small"])
    top -= 19
    left_top = top
    for line in ["Client : ENTREPRISE CLIENT TEST", "Service achats - destinataire fictif", "Devise : EUR"]:
        left_top = para(canvas, line, LEFT, left_top, 70 * mm, s["body"]) - 5
    right_top = top
    for line in [
        "Numéro de facture : " + (inv["invoiceNumber"] or "Non communiqué"),
        "Date de facture : " + date(inv["date"]),
        *(["Date d'échéance : " + layout["dueDate"]] if "dueDate" in layout else []),
    ]:
        right_top = para(canvas, line, LEFT + 87 * mm, right_top, 82 * mm, s["body"]) - 5
    top = min(left_top, right_top) - 22
    has_rates = "itemVatRates" in layout
    headers = ["Désignation", "Quantité", "P.U. HT (EUR)", "Montant HT (EUR)"] + (["TVA"] if has_rates else [])
    widths = [76 * mm, 23 * mm, 34 * mm, 37 * mm] if not has_rates else [66 * mm, 21 * mm, 30 * mm, 34 * mm, 19 * mm]
    data = [[Paragraph(escape(h), s["head"]) for h in headers]]
    for index, item in enumerate(items):
        decimals = max(2, -Decimal(str(item["unitPrice"])).as_tuple().exponent)
        row = [Paragraph(escape(item["description"]), s["table"])]
        row += [Paragraph(escape(v), s["number"]) for v in [quantity(item["quantity"]), number(item["unitPrice"], decimals), number(item["lineTotal"])]]
        if has_rates:
            row.append(Paragraph(quantity(layout["itemVatRates"][item_offset + index]) + " %", s["number"]))
        data.append(row)
    top = table(canvas, data, widths, top, TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), accent),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#F0F5F4"), colors.white]),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LINEBELOW", (0, -1), (-1, -1), 0.6, colors.HexColor("#D3DEDA")),
    ])) - 24
    if page < page_count:
        para(canvas, "Suite des articles et totaux en page 2. Il s'agit d'une seule facture.", LEFT, top, RIGHT - LEFT, s["body"])
    else:
        if has_rates:
            for tax in layout["taxBreakdown"]:
                top = para(canvas, f"TVA {quantity(tax['rate'])} % - Base HT {number(tax['base'])} EUR - Montant {number(tax['amount'])} EUR", LEFT, top, RIGHT - LEFT, s["small"]) - 6
            top -= 12
        totals = [("Total HT", inv["totalHt"]),
                  ("TVA totale" if has_rates else f"TVA {quantity(inv['vatRate'])} %", inv["vatAmount"]),
                  ("TOTAL TTC", inv["totalTtc"])]
        for label, value in totals:
            style = s["total"] if label == "TOTAL TTC" else s["body"]
            para(canvas, label, LEFT + 85 * mm, top, 45 * mm, style)
            canvas.setFont(BOLD if label == "TOTAL TTC" else FONT, 12 if label == "TOTAL TTC" else 10)
            canvas.setFillColor(accent if label == "TOTAL TTC" else colors.HexColor("#24323C"))
            canvas.drawRightString(RIGHT, top - 12, number(value) + " EUR")
            top -= 28
        if layout.get("note"):
            top -= 18
            para(canvas, layout["note"], LEFT, top, RIGHT - LEFT, s["small"])
    canvas.setStrokeColor(colors.HexColor("#CBD5D0"))
    canvas.line(LEFT, 25 * mm, RIGHT, 25 * mm)
    canvas.setFont(FONT, 8)
    canvas.setFillColor(colors.HexColor("#526158"))
    canvas.drawString(LEFT, 18 * mm, "Document de test uniquement - ne pas régler - sans valeur comptable")
    canvas.drawRightString(RIGHT, 18 * mm, f"Page {page} / {page_count}")
    canvas.showPage()

def create(case: dict, temporary: Path, output: Path):
    destination = output / case["fileName"]
    source = temporary / "scan-original.pdf" if case["layout"].get("scan") else destination
    canvas = Canvas(str(source), pagesize=A4, pageCompression=1, invariant=1)
    canvas.setTitle("SPECIMEN - " + (case["invoice"]["invoiceNumber"] or "Champs absents"))
    canvas.setAuthor("Jeu de tests fictifs JUWA")
    items = case["invoice"]["items"]
    split = case["layout"].get("splitAfter")
    chunks = [items[:split], items[split:]] if split else [items]
    for index, chunk in enumerate(chunks):
        render_page(canvas, case, chunk, index + 1, len(chunks), index * (split or 0))
    canvas.save()
    if case["layout"].get("scan"):
        subprocess.run(["pdftoppm", "-r", "120", "-singlefile", "-png", str(source), str(temporary / "scan")], check=True, capture_output=True)
        image = Image.open(temporary / "scan.png").convert("L")
        image = ImageEnhance.Contrast(image).enhance(0.72).filter(ImageFilter.GaussianBlur(0.3))
        image = image.rotate(0.65, resample=Image.Resampling.BICUBIC, fillcolor=255)
        canvas = Canvas(str(destination), pagesize=A4, invariant=1)
        canvas.setTitle("SPECIMEN - SYN-006 - scan")
        canvas.drawInlineImage(image, 0, 0, width=WIDTH, height=HEIGHT)
        canvas.showPage()
        canvas.save()
    reader = PdfReader(destination)
    assert len(reader.pages) == len(chunks)
    if case["layout"].get("scan"):
        assert not any(page.extract_text().strip() for page in reader.pages), "Scan must have no text layer"
    else:
        assert "SPECIMEN" in reader.pages[0].extract_text()
    print(f"{case['fileName']} : {len(reader.pages)} page(s)")

def main():
    parser = argparse.ArgumentParser(description="Generate seven fictional invoice PDFs.")
    parser.add_argument("--output", type=Path, default=DEST, help="Output folder (relative to the project root or absolute)")
    destination = ROOT / parser.parse_args().output
    if not shutil.which("pdftoppm"):
        raise SystemExit("Poppler (pdftoppm) is required for the scanned fixture.")
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="juwa-fixtures-") as work:
        for case in CASES:
            create(case, Path(work), destination)
    print(f"Generated {len(CASES)} fictional invoices in {destination}")

if __name__ == "__main__":
    main()
