from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

from playwright.sync_api import Locator, Page, TimeoutError as PlaywrightTimeout, sync_playwright

from uploader.core.browser_manager import (
    BrowserManager,
    redact_sensitive,
    reset_browser_log_context,
    set_browser_log_context,
)
from uploader.core.proxy_manager import get_active_proxy

logger = logging.getLogger(__name__)

ERROR_LOGS_DIR = Path(os.getenv("ERROR_LOGS_DIR", "./error_logs"))
ERROR_LOGS_DIR.mkdir(parents=True, exist_ok=True)

HEADLESS = os.getenv("FB_HEADLESS", "1") == "1"
FB_ACTION_TIMEOUT_MS = int(os.getenv("FB_ACTION_TIMEOUT_MS", "15000"))
FB_NAVIGATION_TIMEOUT_MS = int(os.getenv("FB_NAVIGATION_TIMEOUT_MS", "30000"))
FB_UPLOAD_TIMEOUT_MS = int(os.getenv("FB_UPLOAD_TIMEOUT_MS", "300000"))
FB_FILE_INPUT_TIMEOUT_MS = int(os.getenv("FB_FILE_INPUT_TIMEOUT_MS", "60000"))
ACTION_TIMEOUT_MS = FB_ACTION_TIMEOUT_MS
NAVIGATION_TIMEOUT_MS = FB_NAVIGATION_TIMEOUT_MS
UPLOAD_TIMEOUT_MS = FB_UPLOAD_TIMEOUT_MS
FILE_INPUT_TIMEOUT_MS = FB_FILE_INPUT_TIMEOUT_MS
FACEBOOK_HOME_URL = "https://www.facebook.com/"
FACEBOOK_BUSINESS_HOME_URL = "https://business.facebook.com/latest/home"


class FacebookUploadError(Exception):
    def __init__(self, message: str, screenshot_path: str | None = None):
        self.screenshot_path = screenshot_path
        super().__init__(f"{message} | screenshot={screenshot_path}" if screenshot_path else message)


@dataclass
class FacebookUploadResult:
    status: str
    published_url: str | None


class FacebookPlaywrightUploader:
    def __init__(
        self,
        account_cookie: str | list[dict[str, Any]] | dict[str, Any] | None,
        proxy_url: str | None = None,
        account_id: str | int | None = None,
        page_url: str | None = None,
        headless: bool = HEADLESS,
        locale: str | None = None,
        timezone_id: str | None = None,
        tenant_id: str | int | None = None,
        platform: str = "facebook",
    ):
        self.cookies = self._parse_cookies(account_cookie)
        self.proxy_url = proxy_url or None
        self.resolved_proxy_url: str | None = None
        self.account_id = account_id or "facebook_dispatch"
        self.tenant_id = tenant_id
        self.platform = platform
        self.page_url = page_url
        self.headless = headless
        self.locale = locale
        self.timezone_id = timezone_id
        self._playwright = None
        self._session = None
        self._context = None
        self._page: Page | None = None

    def publish_video(self, video_path: str, caption: str, job_id: str) -> FacebookUploadResult:
        log_token = set_browser_log_context(job_id=job_id, tenant_id=self.tenant_id, platform=self.platform)
        if not Path(video_path).is_file():
            reset_browser_log_context(log_token)
            raise FacebookUploadError(f"Video file not found: {video_path}")

        try:
            self._playwright = sync_playwright().start()
            self.resolved_proxy_url = self.proxy_url or get_active_proxy()
            logger.info(
                "Playwright session initialized with Proxy: %s",
                redact_sensitive(self.resolved_proxy_url) if self.resolved_proxy_url else "local-network",
            )
            manager = BrowserManager(
                playwright=self._playwright,
                account_id=self.account_id,
                proxy_url=self.resolved_proxy_url,
                headless=self.headless,
                locale=self.locale,
                timezone_id=self.timezone_id,
                action_timeout_ms=ACTION_TIMEOUT_MS,
            )
            try:
                self._session = manager.launch_persistent_session(cookies=self.cookies)
            except Exception as launch_exc:
                if not self.resolved_proxy_url:
                    raise
                logger.warning(
                    "Browser launch with proxy failed; retrying local network. proxy=%s error=%s",
                    redact_sensitive(self.resolved_proxy_url),
                    redact_sensitive(launch_exc),
                )
                self.resolved_proxy_url = None
                manager = BrowserManager(
                    playwright=self._playwright,
                    account_id=self.account_id,
                    proxy_url=None,
                    headless=self.headless,
                    locale=self.locale,
                    timezone_id=self.timezone_id,
                    action_timeout_ms=ACTION_TIMEOUT_MS,
                )
                self._session = manager.launch_persistent_session(cookies=self.cookies)
            self._context = self._session.context
            self._page = self._session.page
            self._page.set_default_navigation_timeout(NAVIGATION_TIMEOUT_MS)

            self.verify_session(job_id)
            self.run_account_readiness_check(job_id)
            post_url = self.execute_upload(self._page, video_path, caption, job_id)
            return FacebookUploadResult(status="published", published_url=post_url)
        except FacebookUploadError:
            raise
        except Exception as exc:
            screenshot = self._take_screenshot(job_id, "unexpected_error")
            raise FacebookUploadError(f"Facebook upload failed: {redact_sensitive(exc)}", screenshot) from exc
        finally:
            try:
                self.close()
            finally:
                reset_browser_log_context(log_token)

    def verify_session(self, job_id: str) -> None:
        page = self._require_page()
        try:
            page.goto(FACEBOOK_HOME_URL, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
        except Exception as exc:
            self._fail(job_id, "session_navigate", f"Cannot navigate to Facebook for session check: {redact_sensitive(exc)}")

        try:
            self._dismiss_optional_dialogs(page)
        except Exception:
            pass

        try:
            login_inputs = page.locator('input[name="email"], input[name="pass"]')
            if login_inputs.count() > 0 and login_inputs.first.is_visible(timeout=3000):
                self._fail(job_id, "login_required", "Facebook session is not authenticated — login form detected")
        except FacebookUploadError:
            raise
        except Exception as exc:
            logger.info("Login form check inconclusive job_id=%s error=%s", job_id, redact_sensitive(exc))

        try:
            page.wait_for_selector('[role="navigation"], [aria-label="Facebook"], a[href*="/me/"]', timeout=FB_ACTION_TIMEOUT_MS)
            logger.info("Facebook session verified for account_id=%s", self.account_id)
        except PlaywrightTimeout:
            logger.warning("Facebook session indicator not found job_id=%s — proceeding cautiously", job_id)
            self._take_screenshot(job_id, "session_indicator_missing")

    def run_account_readiness_check(self, job_id: str) -> None:
        page = self._require_page()
        try:
            page.goto(FACEBOOK_HOME_URL, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
            self._dismiss_optional_dialogs(page)
            page.wait_for_load_state("networkidle", timeout=FB_ACTION_TIMEOUT_MS)
            logger.info("Facebook home readiness check completed for job_id=%s", job_id)
        except Exception as exc:
            logger.warning("Facebook readiness check warning job_id=%s error=%s", job_id, redact_sensitive(exc))
            self._take_screenshot(job_id, "readiness_warning")

    def execute_upload(self, page: Page, video_path: str, caption: str, job_id: str) -> str | None:
        target_url = self.page_url or os.getenv("FACEBOOK_UPLOAD_URL") or FACEBOOK_BUSINESS_HOME_URL
        logger.info("Opening Meta Business Suite upload surface job_id=%s url=%s", job_id, target_url)

        try:
            page.goto(target_url, wait_until="domcontentloaded", timeout=NAVIGATION_TIMEOUT_MS)
            try:
                page.wait_for_load_state("networkidle", timeout=FB_NAVIGATION_TIMEOUT_MS)
            except PlaywrightTimeout:
                logger.info("Meta network-idle timeout job_id=%s; continuing", job_id)
        except Exception as exc:
            self._fail(job_id, "navigate_upload", f"Cannot open Meta Business Suite upload surface: {redact_sensitive(exc)}")

        self._safe_dom_step("dismiss_dialogs_before_create", job_id, lambda: self._dismiss_optional_dialogs(page), fatal=False)
        self._safe_dom_step("click_create_post", job_id, lambda: self._click_create_post(page, job_id), fatal=True)
        self._safe_dom_step("wait_after_create_post", job_id, lambda: page.wait_for_timeout(2500), fatal=False)
        self._safe_dom_step("dismiss_dialogs_after_create", job_id, lambda: self._dismiss_optional_dialogs(page), fatal=False)
        self._safe_dom_step("attach_video", job_id, lambda: self._attach_video_file(page, video_path, job_id), fatal=True)
        self._safe_dom_step("fill_caption", job_id, lambda: self._fill_caption(page, caption, job_id), fatal=True)
        self._safe_dom_step("wait_upload_ready", job_id, lambda: self._wait_until_upload_ready(page, job_id), fatal=True)
        self._safe_dom_step("click_publish", job_id, lambda: self._click_publish(page, job_id), fatal=True)
        return self._wait_for_publish_result(page, job_id)

    def _click_create_post(self, page: Page, job_id: str) -> None:
        try:
            create_post = (
                page.locator('text="Tạo bài viết"')
                .or_(page.locator('text="Create Post"'))
                .or_(page.locator('text="Create post"'))
                .or_(page.locator('[aria-label="Tạo bài viết"]'))
                .or_(page.locator('[aria-label="Create post"]'))
                .first
            )
            create_post.wait_for(state="visible", timeout=FB_ACTION_TIMEOUT_MS)
            create_post.click(timeout=ACTION_TIMEOUT_MS)
            logger.info("Meta create-post button clicked job_id=%s", job_id)
            return
        except Exception as exc:
            logger.warning("Primary create-post locator failed job_id=%s error=%s", job_id, redact_sensitive(exc))
            self._take_screenshot(job_id, "create_post_primary_failed")

        self._click_first_visible(
            page,
            selectors=[
                'div[role="button"]:has-text("Tạo bài viết")',
                'div[role="button"]:has-text("Create Post")',
                'div[role="button"]:has-text("Create post")',
                'span:has-text("Tạo bài viết")',
                'span:has-text("Create Post")',
                'span:has-text("Create post")',
            ],
            job_id=job_id,
            step="open_composer_fallback",
            required=True,
        )

    def _attach_video_file(self, page: Page, video_path: str, job_id: str) -> None:
        # Layer A: click add-video/photo-video controls so Facebook renders file input.
        try:
            trigger_selectors = [
                'div[aria-label="Ảnh/video"]',
                'div[aria-label="Photo/video"]',
                'div[aria-label="Thêm video"]',
                'div[aria-label="Add video"]',
                'div[role="button"]:has-text("Thêm video")',
                'div[role="button"]:has-text("Add video")',
                'div[role="button"]:has-text("Thêm ảnh/video")',
                'div[role="button"]:has-text("Add photos/videos")',
                'div[role="button"]:has-text("Ảnh/video")',
                'div[role="button"]:has-text("Photo/video")',
                'span:has-text("Thêm video")',
                'span:has-text("Add video")',
            ]
            clicked = self._click_first_visible(page, trigger_selectors, job_id, "click_add_video", required=False)
            if clicked:
                logger.info("Add-video trigger clicked job_id=%s", job_id)
        except Exception as exc:
            logger.warning("Add-video trigger layer failed job_id=%s error=%s", job_id, redact_sensitive(exc))

        try:
            page.wait_for_timeout(2000)
        except Exception:
            pass

        # Layer B: force file inputs to become settable/debuggable.
        try:
            page.evaluate(
                """
                () => {
                    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                    inputs.forEach((el) => {
                        el.style.display = 'block';
                        el.style.visibility = 'visible';
                        el.style.opacity = '1';
                        el.style.width = '300px';
                        el.style.height = '50px';
                        el.style.position = 'relative';
                        el.style.zIndex = '2147483647';
                        el.removeAttribute('hidden');
                        el.removeAttribute('disabled');
                    });
                    return inputs.length;
                }
                """
            )
            logger.info("File input evaluate/unhide executed job_id=%s", job_id)
        except Exception as exc:
            logger.warning("File input evaluate/unhide failed job_id=%s error=%s", job_id, redact_sensitive(exc))
            self._take_screenshot(job_id, "file_input_unhide_failed")

        # Layer C: assign file with broad locators and long timeout.
        file_selectors = [
            "input[type='file'][accept*='video']",
            "input[type='file'][accept*='mp4']",
            "input[type='file']",
        ]
        last_error: Exception | None = None
        for selector in file_selectors:
            try:
                file_input = page.locator(selector).last
                if file_input.count() > 0:
                    file_input.set_input_files(video_path, timeout=FILE_INPUT_TIMEOUT_MS)
                    logger.info("Video file attached selector=%s job_id=%s", selector, job_id)
                    return
            except Exception as exc:
                last_error = exc
                logger.warning("set_input_files failed selector=%s job_id=%s error=%s", selector, job_id, redact_sensitive(exc))

        for selector in file_selectors:
            try:
                page.set_input_files(selector, video_path, timeout=FILE_INPUT_TIMEOUT_MS)
                logger.info("Video file attached via page.set_input_files selector=%s job_id=%s", selector, job_id)
                return
            except Exception as exc:
                last_error = exc
                logger.warning("page.set_input_files failed selector=%s job_id=%s error=%s", selector, job_id, redact_sensitive(exc))

        screenshot = self._take_screenshot(job_id, "attach_video_failed")
        raise FacebookUploadError(f"Cannot attach video after all strategies: {redact_sensitive(last_error)}", screenshot)

    def _fill_caption(self, page: Page, caption: str, job_id: str) -> None:
        if not caption:
            return

        try:
            textbox = page.locator('div[role="textbox"]').first
            textbox.wait_for(state="visible", timeout=FB_ACTION_TIMEOUT_MS)
            textbox.fill(caption, timeout=ACTION_TIMEOUT_MS)
            logger.info("Caption filled through Meta textbox job_id=%s chars=%s", job_id, len(caption))
            return
        except Exception as exc:
            logger.warning("Primary caption textbox fill failed job_id=%s error=%s", job_id, redact_sensitive(exc))
            self._take_screenshot(job_id, "caption_primary_failed")

        selectors = [
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"][aria-label*="Write"]',
            'div[contenteditable="true"][aria-label*="Create"]',
            'div[contenteditable="true"][aria-label*="Bạn đang nghĩ"]',
            'textarea',
        ]
        for selector in selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() > 0 and locator.is_visible(timeout=3000):
                    locator.click(timeout=ACTION_TIMEOUT_MS)
                    page.keyboard.press("Control+A")
                    page.keyboard.type(caption, delay=25)
                    logger.info("Caption filled with fallback job_id=%s selector=%s", job_id, selector)
                    return
            except Exception as exc:
                logger.warning("Caption selector failed selector=%s error=%s", selector, redact_sensitive(exc))
        self._fail(job_id, "caption_not_filled", "Cannot fill caption")

    def _wait_until_upload_ready(self, page: Page, job_id: str) -> None:
        logger.info("Waiting for Facebook upload readiness job_id=%s timeout_ms=%s", job_id, UPLOAD_TIMEOUT_MS)
        try:
            page.wait_for_function(
                """() => {
                    const progress = document.querySelector('[role="progressbar"]');
                    if (!progress) return true;
                    const value = progress.getAttribute('aria-valuenow');
                    return value === null || value === '100';
                }""",
                timeout=UPLOAD_TIMEOUT_MS,
            )
            logger.info("Facebook upload readiness confirmed job_id=%s", job_id)
        except PlaywrightTimeout:
            self._fail(job_id, "upload_processing_timeout", f"Upload did not finish within {UPLOAD_TIMEOUT_MS}ms")
        except Exception as exc:
            logger.warning("Upload readiness check warning job_id=%s error=%s", job_id, redact_sensitive(exc))
            self._take_screenshot(job_id, "upload_readiness_warning")

    def _click_publish(self, page: Page, job_id: str) -> None:
        try:
            publish = (
                page.locator('div[role="button"]:has-text("Đăng")')
                .or_(page.locator('div[role="button"]:has-text("Publish")'))
                .or_(page.locator('div[role="button"]:has-text("Post")'))
                .or_(page.locator('text="Đăng"'))
                .or_(page.locator('text="Publish"'))
                .last
            )
            publish.wait_for(state="visible", timeout=FB_ACTION_TIMEOUT_MS)
            publish.scroll_into_view_if_needed(timeout=5000)
            publish.click(timeout=ACTION_TIMEOUT_MS)
            logger.info("Meta publish button clicked job_id=%s", job_id)
            return
        except Exception as exc:
            logger.warning("Primary publish locator failed job_id=%s error=%s", job_id, redact_sensitive(exc))
            self._take_screenshot(job_id, "publish_primary_failed")

        self._click_first_visible(
            page,
            selectors=[
                'div[role="button"]:has-text("Đăng")',
                'div[role="button"]:has-text("Xuất bản")',
                'div[role="button"]:has-text("Publish")',
                'div[role="button"]:has-text("Post")',
                'div[role="button"]:has-text("Share")',
                '[aria-label="Đăng"]',
                '[aria-label="Publish"]',
                '[aria-label="Post"]',
                '[data-testid="react-composer-post-button"]',
            ],
            job_id=job_id,
            step="publish_click_fallback",
            required=True,
        )
        logger.info("Publish action clicked through fallback job_id=%s", job_id)

    def _wait_for_publish_result(self, page: Page, job_id: str) -> str | None:
        try:
            page.wait_for_timeout(5000)
        except Exception:
            pass

        success_selectors = [
            'text="Your post is now published"',
            'text="Your post has been published"',
            'text="Posted"',
            'text="Bài viết của bạn đã được đăng"',
            'text="Đã đăng"',
        ]
        for selector in success_selectors:
            try:
                if page.locator(selector).first.is_visible(timeout=2000):
                    logger.info("Publish success indicator found job_id=%s selector=%s", job_id, selector)
                    break
            except Exception:
                continue

        url = self._extract_post_url(page)
        logger.info("Facebook publish result job_id=%s url=%s", job_id, url)
        return url or page.url

    def _extract_post_url(self, page: Page) -> str | None:
        try:
            current_url = page.url
            if any(marker in current_url for marker in ("/posts/", "/videos/", "/reel/", "watch/?v=")):
                return current_url
        except Exception:
            pass

        link_selectors = [
            'a[href*="/posts/"]',
            'a[href*="/videos/"]',
            'a[href*="/reel/"]',
            'a[href*="watch/?v="]',
        ]
        for selector in link_selectors:
            try:
                link = page.locator(selector).first
                if link.count() > 0:
                    href = link.get_attribute("href")
                    if href:
                        return href if href.startswith("http") else f"https://www.facebook.com{href}"
            except Exception:
                continue
        return None

    def _click_first_visible(
        self,
        page: Page,
        selectors: Iterable[str],
        job_id: str,
        step: str,
        required: bool,
    ) -> Locator | None:
        last_error: Exception | None = None
        for selector in selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() > 0 and locator.is_visible(timeout=3000):
                    locator.click(timeout=ACTION_TIMEOUT_MS)
                    logger.info("Clicked selector step=%s selector=%s", step, selector)
                    return locator
            except Exception as exc:
                last_error = exc
                logger.warning("Click selector failed step=%s selector=%s error=%s", step, selector, redact_sensitive(exc))
        if required:
            self._fail(job_id, step, f"Required UI element not found. Last error={redact_sensitive(last_error)}")
        return None

    def _dismiss_optional_dialogs(self, page: Page) -> None:
        selectors = [
            '[aria-label="Close"]',
            '[aria-label="Đóng"]',
            'div[role="button"]:has-text("Not now")',
            'div[role="button"]:has-text("Không phải bây giờ")',
            'div[role="button"]:has-text("Skip")',
            'div[role="button"]:has-text("Bỏ qua")',
            'button:has-text("Allow all cookies")',
            'button:has-text("Accept all")',
            'button:has-text("Cho phép tất cả cookie")',
        ]
        for selector in selectors:
            try:
                locator = page.locator(selector).first
                if locator.count() > 0 and locator.is_visible(timeout=1000):
                    locator.click(timeout=FB_ACTION_TIMEOUT_MS)
                    page.wait_for_timeout(300)
                    logger.info("Dismissed optional dialog selector=%s", selector)
            except Exception:
                continue

    def _safe_dom_step(self, step: str, job_id: str, action, fatal: bool) -> Any:
        try:
            return action()
        except FacebookUploadError:
            raise
        except Exception as exc:
            logger.warning("DOM step failed step=%s job_id=%s error=%s", step, job_id, redact_sensitive(exc), exc_info=True)
            self._take_screenshot(job_id, step)
            if fatal:
                raise FacebookUploadError(f"DOM step failed: {step}: {redact_sensitive(exc)}") from exc
            return None

    def _require_page(self) -> Page:
        if self._page is None:
            raise FacebookUploadError("Browser page not initialized")
        return self._page

    def close(self) -> None:
        try:
            if self._session:
                self._session.close()
            else:
                try:
                    browser = self._context.browser if self._context else None
                except Exception:
                    browser = None
                try:
                    if self._context:
                        self._context.close()
                        logger.info("Facebook browser context closed")
                except Exception as exc:
                    logger.warning("Facebook browser context cleanup warning: %s", redact_sensitive(exc), exc_info=True)
                finally:
                    try:
                        if browser:
                            browser.close()
                            logger.info("Facebook browser process closed")
                    except Exception as exc:
                        logger.warning("Facebook browser process cleanup warning: %s", redact_sensitive(exc), exc_info=True)
                    finally:
                        try:
                            if self._playwright:
                                self._playwright.stop()
                                logger.info("Facebook Playwright driver stopped")
                        except Exception as exc:
                            logger.warning("Facebook Playwright cleanup warning: %s", redact_sensitive(exc), exc_info=True)
        finally:
            self._session = None
            self._context = None
            self._page = None
            self._playwright = None

    def _take_screenshot(self, job_id: str, step: str) -> str:
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        path = ERROR_LOGS_DIR / f"facebook_{job_id}_{step}_{timestamp}.png"
        try:
            if self._page:
                self._page.screenshot(path=str(path), full_page=True)
                return str(path)
        except Exception as exc:
            logger.warning("Screenshot failed job_id=%s step=%s error=%s", job_id, step, redact_sensitive(exc))
        return ""

    def _fail(self, job_id: str, step: str, message: str) -> None:
        screenshot = self._take_screenshot(job_id, step)
        raise FacebookUploadError(message, screenshot)

    @staticmethod
    def _parse_cookies(raw_cookie: str | list[dict[str, Any]] | dict[str, Any] | None) -> list[dict[str, Any]]:
        if not raw_cookie:
            return []

        data: Any = raw_cookie
        if isinstance(raw_cookie, str):
            stripped = raw_cookie.strip()
            if not stripped:
                return []
            try:
                data = json.loads(stripped)
            except json.JSONDecodeError:
                cookies = []
                for part in stripped.split(";"):
                    if "=" not in part:
                        continue
                    name, value = part.split("=", 1)
                    cookies.append({
                        "name": name.strip(),
                        "value": value.strip(),
                        "domain": ".facebook.com",
                        "path": "/",
                    })
                return cookies

        if isinstance(data, dict):
            if isinstance(data.get("cookies"), list):
                data = data["cookies"]
            else:
                data = [data]

        if not isinstance(data, list):
            raise FacebookUploadError("account_cookie must be JSON cookie list, cookie object, or raw cookie string")

        cookies: list[dict[str, Any]] = []
        for item in data:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()
            value = str(item.get("value") or "").strip()
            if not name or not value:
                continue
            cookie = {
                "name": name,
                "value": value,
                "domain": item.get("domain") or ".facebook.com",
                "path": item.get("path") or "/",
            }
            for key in ("expires", "httpOnly", "secure"):
                if key in item:
                    cookie[key] = item[key]
            same_site = item.get("sameSite")
            if isinstance(same_site, str):
                cookie["sameSite"] = {
                    "strict": "Strict",
                    "lax": "Lax",
                    "none": "None",
                    "no_restriction": "None",
                    "unspecified": "Lax",
                }.get(same_site.lower(), "Lax")
            cookies.append(cookie)
        return cookies
