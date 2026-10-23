"""Local heuristic assistant — the offline brain of Amier OS.

Deterministic, dependency-free intent matching for everyday assistant asks, in
Arabic and English (or a mix). Runs inside the MockProvider: no API key needed
for the common flows («افتح يوتيوب» works offline). Richer semantics still
profit from a real provider key in services/ai-orchestrator/.env.

Security contract unchanged: output is advisory; the Rust rules engine always
re-classifies and the human confirms before anything runs.
"""
from __future__ import annotations

import re
from typing import Callable
from urllib.parse import quote_plus

# ── Arabic normalization (diacritics + letter-form unification) ─────────────
_DIACRITICS = re.compile(r"[\u064B-\u0652\u0670\u0640]")
_FORMS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي"})


def normalize(text: str) -> str:
    t = _DIACRITICS.sub("", text.lower())
    return t.translate(_FORMS)


def _is_ar(text: str) -> bool:
    return any("\u0600" <= ch <= "\u06FF" for ch in text)


def _t(ar: str, en: str) -> str:
    """Return the correct label for a request's language (order chosen below)."""
    return en


# ── vocabulary ───────────────────────────────────────────────────────────────
_VERB = r"(?:افتح|شغل|شغلي|تشغيل|دخل|دخول|run|open|launch|start|go to|goto)\b"
_POLITE = r"(?:\s*(?:لي|please|bidaya)?\s*)"  # «افتح لي يوتيوب» tolerated
_SITES: tuple[tuple[str, str, str], ...] = (
    ("يوتيوب|youtube", "https://www.youtube.com", "يوتيوب / YouTube"),
    ("جوجل|google", "https://www.google.com", "جوجل / Google"),
    ("جيميل|جي ميل|gmail", "https://mail.google.com", "جيميل / Gmail"),
    ("فيسبوك|facebook", "https://www.facebook.com", "فيسبوك / Facebook"),
    ("تويتر|twitter|س\\.com|x\\.com", "https://x.com", "تويتر / X"),
    ("انستجرام|انستغرام|instagram", "https://www.instagram.com", "انستجرام / Instagram"),
    ("واتساب|whatsapp", "https://web.whatsapp.com", "واتساب ويب"),
    ("تليجرام|تلجرام|telegram", "https://web.telegram.org", "تليجرام / Telegram"),
    ("ريديت|reddit", "https://www.reddit.com", "ريديت / Reddit"),
    ("نتفلكس|نتفليكس|netflix", "https://www.netflix.com", "نتفلكس / Netflix"),
    ("تويتش|twitch", "https://www.twitch.tv", "تويتش / Twitch"),
    ("جيتهاب|جيت هب|github", "https://github.com", "جيتهاب / GitHub"),
    ("لينكدان|لينكدين|linkedin", "https://www.linkedin.com", "لينكدإن / LinkedIn"),
    ("خريطه|خريطه جوجل|maps", "https://www.google.com/maps", "خرائط جوجل / Maps"),
    ("ترجمه|ترجمة|translate", "https://translate.google.com", "مترجم جوجل"),
)

_APPS: tuple[tuple[str, str, str], ...] = (
    ("مفكره|المفكره|notepad", "notepad", "المفكرة / Notepad"),
    ("حاسبه|الاله الحاسبه|اله حاسبه|calculator|\bcalc\b", "calc", "الآلة الحاسبة / Calculator"),
    ("رسام|الرسام|paint", "mspaint", "الرسام / Paint"),
    ("مستكشف|استكشاف الملفات|explorer", "explorer", "مستكشف الملفات / Explorer"),
    ("التنزيلات|downloads", 'start "" "%USERPROFILE%\\Downloads"', "مجلد التنزيلات / Downloads"),
    ("الاعدادات|اعدادات ويندوز|settings", "ms-settings:", "إعدادات ويندوز / Settings"),
    ("اداره المهام|مدير المهام|task manager", "taskmgr", "إدارة المهام / Task Manager"),
    ("كروم|chrome", "chrome", "Chrome"),
    ("ايدج|edge", "msedge", "Edge"),
    ("فيسكود|vs code|vscode", "code", "VS Code"),
    ("الطرفيه|ترمنال|طرفية|terminal", "wt", "Windows Terminal"),
)

_DESTRUCTIVE = re.compile(
    r"امسح|إبادة|حذف كامل|format \w+:|diskpart|delete system32|wipe|rm\s+-rf|clean\s+wipe",
    re.IGNORECASE,
)


def _step(command: str, description_ar: str, description_en: str, risk: str, confirm: bool) -> dict[str, object]:
    return {
        "description": f"{description_ar} — {description_en}".strip(" —"),
        "command": command,
        "llm_risk_level": risk,
        "llm_requires_confirmation": confirm,
        "rationale": "Local heuristic assistant (no API needed). Advisory — the Rust rules engine re-classifies.",
    }


class Skill:
    __slots__ = ("rx", "build")

    def __init__(self, pattern: str, build: Callable[[re.Match, str], dict[str, object]]) -> None:
        self.rx = re.compile(pattern, re.IGNORECASE | re.UNICODE)
        self.build = build


def _open_site(site: str, label: re.Match | None = None) -> Callable[[re.Match], dict[str, object]]:
    def build(m: re.Match) -> dict[str, object]:
        return _step(f'cmd /c start "" "{site}"', f"افتح {label or site}", f"open {label or site} in browser", "low", False)
    return build


def _killskills() -> list[Skill]:
    skills: list[Skill] = []

    # 1) destructive intent — refuse plans (never propose)
    skills.append(
        Skill(
            _DESTRUCTIVE.pattern,
            # handled specially inside interpret() — this marker never builds.
            lambda m, raw: _step("cmd /c echo refused", "refused", "refused", "deny", True),
        )
    )

    # 2) open a known website (bilingual aliases)
    for alias, site, label in _SITES:
        skills.append(
            Skill(
                rf"{_VERB}{_POLITE}(?:ال)?{alias}",
                lambda m, raw, s=site, l=label: _step(
                    f'cmd /c start "" "{s}"', f"افتح {l}", f"open {l}", "low", False
                ),
            )
        )

    # 3) generic URL / bare domain after the verb
    skills.append(
        Skill(
            rf"{_VERB}{_POLITE}(?:ال)?\s*(https?://\S+|[\w-]+\.(?:com|net|org|io|dev|ai))",
            lambda m, raw: _step(
                f'cmd /c start "" "https://{m.group(1)}"'.replace("https://https://", "https://"),
                f"افتح {m.group(1)}", f"open {m.group(1)}", "low", False,
            ),
        )
    )

    # 4) web search «ابحث عن الطقس» / «search cats» — query re-taken from the
    #    raw prompt so case survives ("Cute Cats" stays "Cute Cats")
    def _search_build(m: re.Match, raw: str) -> dict[str, object]:
        query = m.group(1).strip()
        try:
            m2 = re.search(
                r"(?:ابحث|بحث|search|google)\s*(?:عن|على|في|for|about)?\s*(.+)", raw,
                re.IGNORECASE | re.UNICODE,
            )
            if m2 and m2.group(1).strip():
                query = m2.group(1).strip()
        except re.error:  # pragma: no cover - static pattern
            pass
        return _step(
            f'cmd /c start "" "https://www.google.com/search?q={quote_plus(query)}"',
            f"ابحث في الويب عن: {query}", f"web search: {query}", "low", False,
        )

    skills.append(Skill(r"(?:ابحث|بحث|search|google)\s*(?:عن|على|في|for|about)?\s*(.+)", _search_build))

    # 5) apps
    for alias, app, label in _APPS:
        skills.append(
            Skill(
                rf"{_VERB}{_POLITE}(?:ال)?(?:تطبيق|برنامج)?\s*(?:{alias})",
                lambda m, raw, a=app, l=label: _step(
                    f"cmd /c start \"\" {a}", f"افتح {l}", f"open {l}", "low", False
                ),
            )
        )

    # 6) time / date
    skills.append(
        Skill(
            r"(?:كم الساعه|الوقت الان|ما الوقت|ما ذا التاريخ|التاريخ اليوم|تاريخ اليوم|تاريخ now|what time|time now|what'?s? the date|today'?s date)",
            lambda m, raw: _step("cmd /c time /t & date /t", "اعرض الوقت والتاريخ", "show time & date", "low", False),
        )
    )

    # 7) create a folder (mutating → confirmation). The name is re-extracted
    #    from the RAW prompt so "اعمل مجلد Music" keeps its capital M.
    def _folder_build(m: re.Match, raw: str) -> dict[str, object]:
        name = m.group(1)
        try:
            m2 = re.search(
                r"(?:مجلد|فولدر|folder|directory)\s*(?:اسمه|يسمى|named|called)?\s*[\"': ]*([\w\-]+)",
                raw, re.IGNORECASE | re.UNICODE,
            )
            if m2 and m2.group(1):
                name = m2.group(1)
        except re.error:  # pragma: no cover - static pattern
            pass
        name = name.strip("\"' ")
        return _step(
            f'cmd /c mkdir "%USERPROFILE%\\Documents\\{name}"',
            f"أنشئ مجلد '{name}' في المستندات",
            f"create folder '{name}' in Documents",
            "medium", True,
        )

    skills.append(
        Skill(
            r"(?:اعمل|انشئ|اصنع|create|make|new)\s*(?:مجلد|فولدر|folder|directory)\s*(?:اسمه|يسمى|named|called)?\s*[\":' ]*([\w\-]+)",
            _folder_build,
        )
    )

    return skills


_SKILLS: list[Skill] | None = None


def _all_skills() -> list[Skill]:
    global _SKILLS
    if _SKILLS is None:
        _SKILLS = _killskills()
    return _SKILLS


def is_destructive(prompt: str) -> bool:
    """Bilingual destructive-intent check (shared with the mock fallback)."""
    return bool(_DESTRUCTIVE.search(normalize(prompt)))


def interpret(prompt: str) -> list[dict[str, object]]:
    """Plan-steps of the first matching local skill ([] when unmatched).

    Very fast, deterministic, bilingual. Destructive requests yield [] (the
    planner surfaces a bilingual refusal upstream), matching the system policy
    of never proposing harmful commands.
    """
    text = normalize(prompt)
    if _DESTRUCTIVE.search(text):
        return []
    for skill in _all_skills():
        m = skill.rx.search(text)
        if m:
            return [skill.build(m, prompt)]
    return []


def chat_reply(prompt: str) -> str:
    """Small deterministic small-talk surface (streaming chat)."""
    text = normalize(prompt)
    if re.search(r"مرحبا|اهلا|هاي|هلا|hello|\bhi\b|hey\b|سلام", text):
        return "أهلاً! أنا Amier OS — مساعدك الشخصي. قل: «افتح يوتيوب» أو «ابحث عن الطقس» وسأنفّذها على جهازك."
    if re.search(r"من انت|ما اسمك|who are you|what are you", text):
        return ("مساعد Amier OS المحلي. بدون مفتاح API أنفّذ المهام اليومية (مواقع/"
                "تطبيقات/بحث/مجلدات)، ومع مفتاح في .env أفهم أي طُلب آخر.")
    if re.search(r"شكرا|msecn|thanks|thank you", text):
        return "دائماً في الخدمة 🌙"
    return ""
