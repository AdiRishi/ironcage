# Regenerates the synthetic statements. Requires `pip install reportlab pypdf`.
from pathlib import Path
from reportlab.pdfgen import canvas

root = Path(__file__).parent

def document(name):
    result = canvas.Canvas(str(root / name), pagesize=(595, 842), invariant=1)
    result.setFont('Helvetica', 9)
    return result

def word(c, x, y, value):
    c.drawString(x, y, value)

# CommBank card statements print the decimal point as a glyph the text layer drops,
# leaving a space where it stood; the dot here reproduces that defect.
def card_money(c, x, y, value):
    word(c, x, y, value)
    gap = value.rfind(' ')
    if gap >= 0:
        c.circle(x + c.stringWidth(value[:gap], 'Helvetica', 9) + 1, y + .6, .5, fill=1, stroke=0)

def card_statement(name, period):
    c = document(name)
    word(c, 373, 768, 'Ultimate Awards Credit Card')
    word(c, 466, 752, '5555 0000 0000 1111')
    word(c, 354, 711, 'Statement Period')
    word(c, 452, 711, period)
    for y, label, value in [(592, 'Opening balance at 1 Dec', '$100 00'), (571, 'New transactions and charges', '$12 50'), (550, 'Payments/refunds', '$50 00'), (528, 'Closing balance at 3 Jan', '$62 50')]:
        word(c, 57, y, label)
        card_money(c, 239, y, value)
    c.showPage()
    c.setFont('Helvetica', 9)
    for x, value in [(52, 'Date'), (92, 'Transaction details'), (510, 'Amount (A$)')]:
        word(c, x, 516, value)
    for y, date, description, value in [(499, '31 Dec', 'Book shop', '12 50'), (482, '02 Jan', 'Repayment', '50 00-'), (465, '03 Jan', 'Monthly fee waived', '0 00')]:
        word(c, 52, y, date)
        word(c, 92, y, description)
        card_money(c, 536, y, value)
    c.save()

card_statement('card.pdf', '1 Dec 2025 - 3 Jan 2026')
card_statement('card-invalid-period.pdf', '1 Dec 2025 - 31 Fob 2026')

c = document('deposit.pdf')
word(c, 354, 748, 'Account Number')
word(c, 455, 748, '12 3456 11111111')
word(c, 354, 715, 'Statement Period')
word(c, 426, 715, '1 Aug 2026 - 31 Aug 2026')
for x, value in [(58, 'Date'), (89, 'Transaction'), (362, 'Debit'), (411, 'Credit'), (499, 'Balance')]:
    word(c, x, 437, value)
word(c, 58, 418, '01 Aug')
word(c, 89, 418, '2026 OPENING BALANCE')
word(c, 478, 418, '$20,000.00 CR')
word(c, 58, 395, '02 Aug 2024 Books')
word(c, 365, 395, '12.50')
word(c, 396, 395, '(')
word(c, 478, 395, '$19,987.50 CR')
word(c, 58, 375, '03 Aug Large transfer')
word(c, 340, 375, '10,000.00')
word(c, 396, 375, '$')
word(c, 478, 375, '$9,987.50 CR')
word(c, 58, 355, '31 Aug 2026 CLOSING BALANCE')
word(c, 478, 355, '$9,987.50 CR')
for x, label, value in [(275, 'Total debits', '$10,012.50'), (369, 'Total credits', '$0.00')]:
    word(c, x, 320, label)
    word(c, x, 302, value)
c.save()

c = document('loan.pdf')
word(c, 354, 756, 'Account number')
word(c, 516, 756, '222222222')
word(c, 354, 737, 'Statement period')
word(c, 446, 737, '1 Aug 2026 - 31 Aug 2026')
word(c, 56, 525, 'Complete Home Loan Transactions')
for x, value in [(56, 'Date'), (97, 'Transaction'), (330, 'Debits'), (403, 'Credits'), (522, 'Balance')]:
    word(c, x, 504, value)
for y, date, description, debit, credit, balance in [(467, '01 Aug', 'Opening balance', '', '', '$1,000.00 DR'), (447, '02 Aug', 'Interest', '10.00', '', '$1,010.00 DR'), (427, '03 Aug', 'Repayment', '', '$100.00', '$910.00 DR'), (407, '04 Aug', 'Interest rate 5.00% per annum', '', '', ''), (387, '31 Aug', 'Closing balance', '', '', '$910.00 DR')]:
    for x, value in [(56, date), (97, description), (330, debit), (403, credit), (492, balance)]:
        if value:
            word(c, x, y, value)
c.save()

from pypdf import PdfReader, PdfWriter
writer = PdfWriter()
for page in PdfReader(root / 'card.pdf').pages:
    writer.add_page(page)
writer.add_blank_page(width=595, height=842)
with (root / 'card-unreadable.pdf').open('wb') as output:
    writer.write(output)
