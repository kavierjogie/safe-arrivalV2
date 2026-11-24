import re, sys, os
from playwright.sync_api import sync_playwright, expect

# End-to-end UI test of both demo scenarios (tourist, hotel, driver, admin; two tabs + mobile).
# Usage: npm run dev, then  pip install playwright && playwright install chromium && python3 scripts/e2e.py
BASE = os.environ.get('BASE_URL', 'http://localhost:5173')
SHOTS = os.environ.get('SHOTS_DIR', '/tmp/shots')
os.makedirs(SHOTS, exist_ok=True)
errors = []

def watch(page, name):
    page.on('console', lambda m: m.type == 'error' and errors.append(f'[{name}] {m.text}'))
    page.on('pageerror', lambda e: errors.append(f'[{name}] PAGEERROR {e}'))

def shot(page, name):
    page.screenshot(path=f'{SHOTS}/{name}.png', full_page=False)

def tap_list(page, button, row):
    page.get_by_role('button', name=button).last.click()
    page.get_by_role('dialog', name=button).get_by_role('button', name=re.compile(row)).first.click()

PAGES=[]
def main(p):
    browser = p.chromium.launch(**({'executable_path': os.environ['CHROME_PATH']} if os.environ.get('CHROME_PATH') else {}), args=['--no-sandbox'])
    ctx = browser.new_context(viewport={'width': 1280, 'height': 900})
    ctx.set_default_timeout(20000)
    A = ctx.new_page(); watch(A, 'tourist'); PAGES.append(A)

    # ---- Landing + DB boot
    A.goto(BASE + '/')
    expect(A.get_by_role('status').filter(has_text='Demo mode')).to_be_visible(timeout=60000)
    shot(A, '01-landing')

    # ---- Scenario 1: WhatsApp booking
    A.goto(BASE + '/assistant?hotel=hotel-001')
    A.get_by_role('button', name=re.compile('Send “Hi”')).click()
    expect(A.get_by_text('Welcome to Cape Town!')).to_be_visible()
    tap_list(A, 'Choose an option', 'Arrange transport')
    tap_list(A, 'Pickup location', 'International Arrivals')
    A.get_by_role('button', name='Tomorrow').click()
    A.get_by_role('button', name='14:30').click()
    tap_list(A, 'Passengers', '^2 passengers')
    tap_list(A, 'Luggage', '^2 bags')
    A.get_by_role('button', name='Sarah Mitchell').click()
    tap_list(A, 'See options', 'Saltwater Lodge Transf')
    expect(A.get_by_text('R450 agreed price').last).to_be_visible()
    shot(A, '02-chat-confirm')
    A.get_by_role('button', name='Confirm booking').click()
    expect(A.get_by_text(re.compile(r'Reference: CT-TRIP-\d{4}-\d{3}'))).to_be_visible()
    ref = re.search(r'CT-TRIP-\d{4}-\d{3}', A.get_by_text(re.compile(r'Reference: CT-TRIP')).inner_text()).group(0)
    print('booking', ref)
    expect(A.get_by_text('Booking request received').or_(A.get_by_text(re.compile('Your transport request .* has been received')))).to_be_visible()
    shot(A, '03-chat-booked')

    # ---- Hotel confirms + assigns (second tab, live)
    B = ctx.new_page(); watch(B, 'hotel'); PAGES.append(B)
    B.goto(BASE + '/login')
    B.get_by_role('button', name=re.compile('Fatima Isaacs')).click()
    B.wait_for_url('**/hotel')
    expect(B.get_by_text(ref).first).to_be_visible()
    shot(B, '04-hotel-overview')
    B.goto(BASE + '/hotel/bookings')
    B.get_by_role('button', name=ref).click()
    B.get_by_role('button', name='Confirm booking').click()
    expect(B.get_by_text(re.compile('confirmed. Tourist notified'))).to_be_visible()
    B.get_by_label('Driver').select_option(label='Michael Daniels')
    B.get_by_label('Vehicle').select_option(label='White Toyota Corolla · CA 123-456')
    shot(B, '05-hotel-assign')
    B.get_by_role('button', name=re.compile('Assign')).click()
    expect(B.get_by_text(re.compile('Driver assigned. A new one-time code'))).to_be_visible()
    B.keyboard.press('Escape')

    # ---- Tourist receives driver + code live in chat
    expect(A.get_by_text('YOUR DRIVER HAS BEEN ASSIGNED')).to_be_visible(timeout=20000)
    body = A.get_by_text('YOUR DRIVER HAS BEEN ASSIGNED').inner_text()
    code = re.search(r'Verification code: ([A-Z]+ [A-Z]+ \d{2})', body).group(1)
    print('code', code)
    shot(A, '06-chat-driver')
    trip_url = A.locator('a[href*="/trip/"]').first.get_attribute('href')
    A.goto(trip_url)
    expect(A.get_by_text(code, exact=True).first).to_be_visible()
    expect(A.get_by_text('CA 123-456').first).to_be_visible()
    shot(A, '07-trip-page')
    A.screenshot(path=f'{SHOTS}/07b-trip-full.png', full_page=True)

    # ---- Driver: on the way, arrived; cannot start ride
    B.goto(BASE + '/login')
    B.get_by_role('button', name=re.compile('Michael Daniels')).click()
    B.wait_for_url('**/driver')
    expect(B.get_by_text(code, exact=True).first).to_be_visible()
    B.get_by_role('button', name=re.compile('on my way')).click()
    B.get_by_role('button', name=re.compile('arrived')).click()
    expect(B.get_by_text(re.compile('You can’t start it yourself'))).to_be_visible()
    shot(B, '08-driver')

    # ---- Tourist verifies (typed spoken code, then confirms)
    expect(A.get_by_text('Your driver has arrived at the pickup point.')).to_be_visible(timeout=20000)
    A.get_by_placeholder('e.g. blue table 47').fill('purple kite 99')
    A.get_by_role('button', name='Check', exact=True).click()
    expect(A.get_by_text('That does NOT match')).to_be_visible()
    A.get_by_placeholder('e.g. blue table 47').fill(code.lower())
    A.get_by_role('button', name='Check', exact=True).click()
    expect(A.get_by_text('That matches your code.')).to_be_visible()
    shot(A, '09-verify')
    A.get_by_role('button', name=re.compile('^Driver verified')).click()
    expect(A.get_by_text('Ride in progress').first).to_be_visible()
    expect(A.get_by_text('Your code was used when you verified your driver.')).to_be_visible()
    print('scenario 1 ok')

    # ---- Scenario 2: form booking → hotel shortcut → wrong vehicle → incident
    A.goto(BASE + '/book?hotel=hotel-001')
    A.get_by_label('Arrival time (Cape Town time)').fill('23:30')
    A.get_by_label('Arrival date').fill('2027-01-15')
    A.get_by_text('Saltwater Lodge Transfers').first.click()
    A.get_by_role('button', name='Request booking').click()
    A.wait_for_url('**/trip/**')
    ref2 = A.locator('p.font-mono').first.inner_text()
    print('booking 2', ref2)
    A.get_by_role('button', name=re.compile('Guided demo')).click()
    A.get_by_role('button', name=re.compile('Hotel: confirm \\+ assign Michael')).click()
    expect(A.get_by_text(re.compile('Hotel confirmed and assigned Michael'))).to_be_visible()
    A.keyboard.press('Escape')
    expect(A.get_by_role('heading', name='Verify your driver')).to_be_visible(timeout=20000)
    A.get_by_role('button', name=re.compile('^Wrong vehicle')).click()
    A.wait_for_url('**/report?**')
    expect(A.get_by_label('Vehicle does not match')).to_be_checked()
    A.get_by_label(re.compile('Describe what happened')).fill('A man said he was my driver but the registration was CA 999-111 and he wanted cash.')
    shot(A, '10-report')
    A.get_by_role('button', name='Send report').click()
    A.wait_for_url('**/incident/**')
    expect(A.get_by_text('Your report has been received.')).to_be_visible()
    inc = re.search(r'SAFE-\d{4}-\d{4}', A.content()).group(0)
    print('incident', inc)
    expect(A.get_by_text('Hotel response pending').first).to_be_visible()
    shot(A, '11-incident-tracking')

    # ---- Hotel acknowledges → tourist sees follow-up live
    B.goto(BASE + '/login')
    B.get_by_role('button', name=re.compile('Fatima Isaacs')).click()
    B.wait_for_url('**/hotel')
    B.goto(BASE + '/hotel/incidents')
    B.get_by_role('button', name=re.compile(inc)).click()
    expect(B.get_by_text('registration was CA 999-111').first).to_be_visible()
    shot(B, '12-hotel-incident')
    B.get_by_role('button', name='Acknowledge').click()
    expect(B.get_by_text('Update saved. The tourist was notified.')).to_be_visible()
    expect(A.get_by_text('Follow-up in progress').first).to_be_visible(timeout=20000)
    shot(A, '13-incident-updated')
    B.keyboard.press('Escape')

    # ---- Admin
    B.goto(BASE + '/login')
    B.get_by_role('button', name=re.compile('Nomsa Dlamini')).click()
    B.wait_for_url('**/admin')
    expect(B.get_by_text(re.compile('unexpected additional payment requests were reported'))).to_be_visible()
    shot(B, '14-admin-overview')
    B.goto(BASE + '/admin/analytics'); B.wait_for_timeout(1500); shot(B, '15-admin-analytics')
    B.goto(BASE + '/admin/partners'); expect(B.get_by_text('Lerato Mokoena')).to_be_visible(); shot(B, '16-admin-partners')
    B.goto(BASE + '/admin/audit'); expect(B.get_by_text('assign driver').first).to_be_visible(); shot(B, '17-audit')

    # ---- RLS in the UI: driver cannot open the admin area
    B.goto(BASE + '/login'); B.get_by_role('button', name=re.compile('Michael Daniels')).click(); B.wait_for_url('**/driver')
    B.goto(BASE + '/admin'); expect(B.get_by_text('Not available for your account')).to_be_visible()

    # ---- Mobile tourist view
    M = ctx.new_page(); M.set_viewport_size({'width': 390, 'height': 844}); watch(M, 'mobile')
    M.goto(trip_url); expect(M.get_by_text(re.compile('Hi Sarah'))).to_be_visible(timeout=60000); shot(M, '18-mobile-trip')
    M.goto(BASE + '/assistant?hotel=hotel-001'); M.wait_for_timeout(1500); shot(M, '19-mobile-chat')
    B.goto(BASE + '/login'); B.get_by_role('button', name=re.compile('Fatima Isaacs')).click(); B.wait_for_url('**/hotel')
    B.goto(BASE + '/hotel/setup'); expect(B.get_by_text('Printable QR poster')).to_be_visible(); shot(B, '20-hotel-qr')
    A.goto(BASE + '/start?hotel=hotel-001'); expect(A.get_by_text('Check before you share anything')).to_be_visible(); shot(A, '21-start')
    print('scenario 2 ok')
    # ---- Presenter reset restores seed data
    B.goto(BASE + '/login'); B.get_by_role('button', name=re.compile('Nomsa Dlamini')).click(); B.wait_for_url('**/admin')
    B.get_by_role('button', name='Reset').click()
    B.get_by_role('button', name='Reset demo').click()
    B.wait_for_timeout(2500)
    B.goto(BASE + '/admin')
    expect(B.get_by_text('Tourist bookings').locator('..').locator('..')).to_contain_text('33', timeout=60000)
    print('reset ok')
    browser.close()

with sync_playwright() as p:
    try:
        main(p)
    except Exception as ex:
        print('FAILED:', str(ex).splitlines()[0])
        for i,pg in enumerate(PAGES):
            pg.screenshot(path=f'{SHOTS}/FAIL-{i}.png')
            print('PAGE', i, pg.url, pg.locator('body').inner_text()[-1200:].replace('\n',' | '))
        raise
print('console errors:', len(errors))
for e in errors[:20]: print(' ', e[:300])
