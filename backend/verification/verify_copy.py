from playwright.sync_api import sync_playwright, expect
import os
import re

def test_copy_button():
    # Get absolute path to the HTML file
    file_path = os.path.abspath("backend/verification/test.html")
    file_url = f"file://{file_path}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Grant clipboard permissions - though file:// might not support it perfectly in headless, we'll see
        context = browser.new_context(permissions=["clipboard-read", "clipboard-write"])
        page = context.new_page()

        print(f"Navigating to {file_url}")
        page.goto(file_url)

        # Verify page loaded
        expect(page.get_by_role("heading", name="Test Copy Button")).to_be_visible()

        # Get the first copy button
        # data-copy="TestUUID1"
        btn1 = page.locator('button[data-copy="TestUUID1"]')

        # Check initial state
        expect(btn1).to_be_visible()
        expect(btn1).to_have_attribute("aria-label", "Copy identifier")

        print("Clicking button...")
        # Click the button
        btn1.click()

        # Verify it changed to "Copied" state
        # The class becomes "copy-btn copied"
        # We use a regex for class check as order might vary
        expect(btn1).to_have_class(re.compile(r"copied"))
        expect(btn1).to_have_attribute("aria-label", "Copied")
        # expect(btn1).to_have_attribute("title", "Copied")
        # Title might be tricky with tooltips, but aria-label is key for a11y

        print("Button changed state correctly.")

        # Take screenshot of the "Copied" state
        page.screenshot(path="backend/verification/verification.png")
        print("Screenshot saved to backend/verification/verification.png")

        # Wait for 2 seconds and verify it reverts
        print("Waiting for reset...")
        page.wait_for_timeout(2200) # Wait slightly more than 2s

        expect(btn1).not_to_have_class(re.compile(r"copied"))
        expect(btn1).to_have_attribute("aria-label", "Copy identifier")

        # Check attribute absence manually
        data_copying = btn1.get_attribute("data-copying")
        if data_copying is not None:
             raise AssertionError(f"Expected data-copying to be None, got {data_copying}")

        print("Button reverted correctly.")
        print("Verification passed!")
        browser.close()

if __name__ == "__main__":
    test_copy_button()
