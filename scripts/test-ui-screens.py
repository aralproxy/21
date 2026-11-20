"""Screenshot the Aral Neon UI (login, dashboard, clients, nodes, mobile) with Playwright."""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:18082"
OUT = "/tmp/neon-ui"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        # ---- login page (desktop) ----
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await page.goto(f"{BASE}/neon/login.html", wait_until="domcontentloaded")
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"{OUT}/01-login.png")

        # ---- login flow into dashboard ----
        await page.fill("#pw", "ui-test-123")
        await page.click("#btnLogin")
        await page.wait_for_timeout(2500)
        await page.screenshot(path=f"{OUT}/02-dashboard.png")

        # ---- clients view ----
        await page.click('.nav-item[data-view="clients"]')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{OUT}/03-clients.png")

        # ---- client links modal (QR) ----
        await page.click("#clientsBody [data-links]")
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"{OUT}/04-links-qr.png")
        # close via backdrop click (modal only closes on backdrop / its own button)
        await page.evaluate("document.getElementById('modalBack').click()")
        await page.wait_for_timeout(500)

        # ---- nodes view ----
        await page.click('.nav-item[data-view="nodes"]')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{OUT}/05-nodes.png")

        # ---- protocols view ----
        await page.click('.nav-item[data-view="protocols"]')
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"{OUT}/06-protocols.png")

        # ---- settings view ----
        await page.click('.nav-item[data-view="settings"]')
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"{OUT}/07-settings.png")

        # ---- english + light mode ----
        await page.click("#btnLang")
        await page.click("#btnTheme")
        await page.click('.nav-item[data-view="dashboard"]')
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"{OUT}/08-dashboard-en-light.png")

        # ---- mobile (RTL, 375px) ----
        mob = await browser.new_page(viewport={"width": 375, "height": 812})
        await mob.goto(f"{BASE}/neon/", wait_until="domcontentloaded")
        await mob.wait_for_timeout(2000)
        # need to login again on this context
        if mob.url.endswith("login.html"):
            await mob.fill("#pw", "ui-test-123")
            await mob.click("#btnLogin")
            await mob.wait_for_timeout(2000)
        await mob.screenshot(path=f"{OUT}/09-mobile-dashboard.png")
        await mob.click("#burger")
        await mob.wait_for_timeout(500)
        await mob.screenshot(path=f"{OUT}/10-mobile-menu.png")

        # ---- subscription page (browser view) ----
        sub = await browser.new_page(viewport={"width": 414, "height": 900})
        await sub.goto(f"{BASE}/sub/Y3Phv0bAmAhsZ47X", wait_until="domcontentloaded")
        await sub.wait_for_timeout(800)
        await sub.screenshot(path=f"{OUT}/11-subpage.png")
        await browser.close()

asyncio.run(main())
print("screenshots done")
