"""Fictional records drawn from fixed bilingual component lists."""

import hashlib
import random
from datetime import date, timedelta

FIRST_NAMES = (
    ("Ahmed", "أحمد"), ("Mohamed", "محمد"), ("Omar", "عمر"), ("Ali", "علي"),
    ("Yusuf", "يوسف"), ("Hassan", "حسن"), ("Hussein", "حسين"), ("Khalid", "خالد"),
    ("Salim", "سالم"), ("Saeed", "سعيد"), ("Ibrahim", "إبراهيم"), ("Kareem", "كريم"),
    ("Tariq", "طارق"), ("Nader", "نادر"), ("Faisal", "فيصل"), ("Rashid", "راشد"),
    ("Fatima", "فاطمة"), ("Aisha", "عائشة"), ("Mariam", "مريم"), ("Sara", "سارة"),
    ("Noura", "نورة"), ("Layla", "ليلى"), ("Huda", "هدى"), ("Amal", "أمل"),
    ("Salma", "سلمى"), ("Hana", "هناء"), ("Dalia", "داليا"), ("Rania", "رانيا"),
    ("Yasmin", "ياسمين"), ("Iman", "إيمان"), ("Reem", "ريم"), ("Amina", "أمينة"),
)
FAMILY_NAMES = (
    ("Al Mansoori", "المنصوري"), ("Al Nuaimi", "النعيمي"), ("Al Qasimi", "القاسمي"),
    ("Al Hammadi", "الحمادي"), ("Al Mazrouei", "المزروعي"), ("Al Shamsi", "الشامسي"),
    ("Al Suwaidi", "السويدي"), ("Al Kaabi", "الكعبي"), ("Al Dhaheri", "الظاهري"),
    ("Al Ameri", "العامري"), ("Al Ketbi", "الكتبي"), ("Al Zaabi", "الزعابي"),
    ("Al Hosani", "الحوسني"), ("Al Rumaithi", "الرميثي"), ("Al Falasi", "الفلاسي"),
    ("Al Marri", "المري"), ("Haddad", "حداد"), ("Nasser", "ناصر"), ("Saleh", "صالح"),
    ("Mansour", "منصور"), ("Hamdan", "حمدان"), ("Khalil", "خليل"), ("Farouk", "فاروق"),
    ("Sabri", "صبري"), ("Najjar", "نجار"), ("Qureshi", "قريشي"), ("Malik", "مالك"),
    ("Rahman", "رحمن"), ("Darwish", "درويش"), ("Salman", "سلمان"),
    ("Haroun", "هارون"), ("Fahmy", "فهمي"),
)
NATIONALITIES = (
    ("United Arab Emirates", "الإمارات العربية المتحدة"), ("Egypt", "مصر"),
    ("India", "الهند"), ("Pakistan", "باكستان"), ("Jordan", "الأردن"),
    ("Philippines", "الفلبين"), ("United Kingdom", "المملكة المتحدة"),
    ("Syria", "سوريا"), ("Lebanon", "لبنان"), ("Sudan", "السودان"),
)
DISTRICTS = (
    ("Al Reem Island", "جزيرة الريم"), ("Al Khalidiyah", "الخالدية"),
    ("Mohammed Bin Zayed City", "مدينة محمد بن زايد"), ("Khalifa City", "مدينة خليفة"),
    ("Al Raha Beach", "شاطئ الراحة"), ("Al Mushrif", "المشرف"),
    ("Saadiyat Island", "جزيرة السعديات"), ("Yas Island", "جزيرة ياس"),
    ("Al Muroor", "المرور"), ("Al Nahyan", "آل نهيان"),
)


def document_seed(master_seed: int, kind: str, index: int) -> int:
    """Derive a stable seed from the master seed and kind-local document index."""
    return int.from_bytes(hashlib.sha256(f"{master_seed}:{kind}:{index}".encode()).digest()[:4])


def luhn_digit(prefix: str) -> str:
    """Compute the check digit for a numeric prefix without using real identifiers."""
    if not prefix.isascii() or not prefix.isdigit():
        raise ValueError("Luhn input must contain ASCII digits only")
    total = 0
    for index, digit in enumerate(reversed(prefix)):
        value = int(digit) * (2 if index % 2 == 0 else 1)
        total += value - 9 if value > 9 else value
    return str((-total) % 10)


def emirates_id(birth_year: int, serial: int) -> str:
    """Build a checkable identifier confined to the flagged synthetic serial block."""
    if not 1955 <= birth_year <= 2005 or not 0 <= serial <= 9999:
        raise ValueError("Synthetic birth year or serial is outside its permitted range")
    prefix = f"784{birth_year}000{serial:04d}"
    return f"784-{birth_year}-000{serial:04d}-{luhn_digit(prefix)}"


def random_name(rng: random.Random) -> tuple[str, str]:
    """Combine independently sampled paired components, never a person registry."""
    first, family = rng.choice(FIRST_NAMES), rng.choice(FAMILY_NAMES)
    return f"{first[0]} {family[0]}", f"{first[1]} {family[1]}"


def random_date(rng: random.Random, first_year: int, last_year: int) -> date:
    """Sample calendar-safe dates with day at most 28 for unambiguous anniversaries."""
    return date(rng.randint(first_year, last_year), rng.randint(1, 12), rng.randint(1, 28))


def make_record(kind: str, rng: random.Random) -> dict[str, str]:
    """Create canonical synthetic truth with consistent dates and financial ranges."""
    birth = random_date(rng, 1955, 2005)
    identity = emirates_id(birth.year, rng.randrange(10000))
    issue = random_date(rng, 2020, 2028)
    name_en, name_ar = random_name(rng)
    if kind == "emirates_id":
        nationality_en, nationality_ar = rng.choice(NATIONALITIES)
        return {
            "id_number": identity, "name_en": name_en, "name_ar": name_ar,
            "nationality_en": nationality_en, "nationality_ar": nationality_ar,
            "date_of_birth": birth.isoformat(), "sex": rng.choice(("M", "F")),
            "issue_date": issue.isoformat(),
            "expiry_date": issue.replace(year=issue.year + rng.randint(2, 10)).isoformat(),
            "card_number": f"000{rng.randrange(1000000):06d}",
        }
    district_en, district_ar = rng.choice(DISTRICTS)
    unit = rng.choice((str(rng.randint(101, 2509)), f"B-{rng.randint(101, 909)}", f"V-{rng.randint(1, 99)}"))
    plot = f"P{rng.randrange(100):02d}-{rng.randrange(1000):03d}"
    if kind == "tawtheeq_contract":
        landlord_en, landlord_ar = random_name(rng)
        start = random_date(rng, 2024, 2028)
        rent = rng.randrange(70, 801) * 500
        percent = rng.randint(5, 10)
        deposit = ((rent * percent + 5000) // 10000) * 100
        return {
            "contract_number": f"SPC-{start.year}-{rng.randrange(1000000):06d}",
            "registration_date": (start - timedelta(days=rng.randint(0, 20))).isoformat(),
            "landlord_name_en": landlord_en, "landlord_name_ar": landlord_ar,
            "tenant_name_en": name_en, "tenant_name_ar": name_ar, "tenant_id_number": identity,
            "unit_number": unit, "plot_number": plot,
            "district_en": district_en, "district_ar": district_ar,
            "property_usage": rng.choice(("RESIDENTIAL", "COMMERCIAL")),
            "start_date": start.isoformat(),
            "end_date": (start.replace(year=start.year + 1) - timedelta(days=1)).isoformat(),
            "annual_rent": f"{rent}.00", "security_deposit": f"{deposit}.00",
            "number_of_cheques": str(rng.choice((1, 2, 4, 6, 12))),
        }
    if kind == "title_deed":
        area_tenths = rng.randint(450, 6500)
        return {
            "deed_number": f"SPC-D-{rng.randrange(10000000):07d}", "issue_date": issue.isoformat(),
            "owner_name_en": name_en, "owner_name_ar": name_ar, "owner_id_number": identity,
            "plot_number": plot, "unit_number": unit,
            "district_en": district_en, "district_ar": district_ar,
            "property_type": rng.choice(("APARTMENT", "VILLA", "TOWNHOUSE", "LAND")),
            "area_sq_m": f"{area_tenths // 10}.{area_tenths % 10}",
        }
    raise ValueError(f"Unknown document kind: {kind}")
