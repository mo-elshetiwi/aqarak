"""Ordered field definitions shared by rendering and validation."""

from dataclasses import dataclass
from typing import Literal, TypedDict

FieldType = Literal["id_number", "name", "text", "date", "money", "integer", "decimal", "code"]
Script = Literal["latin", "arabic", "neutral"]
Condition = Literal["readable", "absent", "occluded", "distractor"]
Box = list[int] | list[float]


class DecoyLabel(TypedDict):
    """Store the exact visible decoy and its final position."""

    label_en: str
    label_ar: str
    printed: str
    value: str
    image_box: Box


class FieldLabel(TypedDict):
    """Separate canonical truth from what the image supports."""

    type: FieldType
    script: Script
    condition: Condition
    value: str | None
    true_value: str
    printed: str | None
    render_box: Box | None
    image_box: Box | None
    decoy: DecoyLabel | None


class CaptureSettings(TypedDict):
    """Describe every sampled capture parameter without hidden randomness."""

    blur_sigma: float
    glare: dict[str, float]
    rotation_deg: float
    perspective_jitter: list[list[float]]
    jpeg_quality: int
    digits: str


class RenderCheck(TypedDict):
    """Summarise checks performed on the clean image."""

    readable_drawn: int
    occluded_covered: int
    absent_not_drawn: int
    decoys_drawn: int
    passed: bool


class DocumentLabel(TypedDict):
    """Describe a synthetic document and its supported extraction labels."""

    doc_id: str
    kind: str
    synthetic: bool
    generator_version: str
    seed: int
    layout_family: str
    image: str
    image_sha256: str
    width: int
    height: int
    capture: CaptureSettings
    fields: dict[str, FieldLabel]
    render_check: RenderCheck


@dataclass(frozen=True)
class Field:
    """Keep field names, types and bilingual label alternatives together."""

    name: str
    type: FieldType
    script: Script
    en: tuple[str, str]
    ar: tuple[str, str]
    decoy_en: str
    decoy_ar: str


def field(name: str, kind: FieldType, en: str, ar: str, *, script: Script = "neutral",
          alt_en: str | None = None, alt_ar: str | None = None,
          decoy_en: str = "Reference No.", decoy_ar: str = "رقم المرجع") -> Field:
    """Build a field definition with explicit, stable label alternatives."""
    return Field(name, kind, script, (en, alt_en or en), (ar, alt_ar or ar), decoy_en, decoy_ar)


def person(prefix: str, en: str, ar: str) -> tuple[Field, Field]:
    """Define separate English and Arabic name rows to preserve both scripts."""
    return (
        field(f"{prefix}_en", "name", f"{en} (English)", f"{ar} بالإنجليزية", script="latin",
              alt_en=f"{en} in English", decoy_en="Previous holder (English)", decoy_ar="الحامل السابق بالإنجليزية"),
        field(f"{prefix}_ar", "name", f"{en} (Arabic)", f"{ar} بالعربية", script="arabic",
              alt_en=f"{en} in Arabic", decoy_en="Previous holder (Arabic)", decoy_ar="الحامل السابق بالعربية"),
    )


def district() -> tuple[Field, Field]:
    """Define the district pair in the catalogue's fixed order."""
    return (
        field("district_en", "text", "District (English)", "المنطقة بالإنجليزية", script="latin",
              alt_en="Area (English)", decoy_en="Previous district", decoy_ar="المنطقة السابقة"),
        field("district_ar", "text", "District (Arabic)", "المنطقة بالعربية", script="arabic",
              alt_en="Area (Arabic)", decoy_en="Previous district (Arabic)", decoy_ar="المنطقة السابقة بالعربية"),
    )


UNIT = field("unit_number", "code", "Unit No.", "رقم الوحدة", alt_en="Unit reference",
             decoy_en="Adjacent unit", decoy_ar="الوحدة المجاورة")
PLOT = field("plot_number", "code", "Plot No.", "رقم القطعة", alt_en="Plot reference",
             decoy_en="Nearby plot", decoy_ar="قطعة مجاورة")
ISSUE = field("issue_date", "date", "Issue date", "تاريخ الإصدار", alt_en="Issued on",
              decoy_en="Copy printed on", decoy_ar="تاريخ طباعة النسخة")
CATALOGUE: dict[str, tuple[Field, ...]] = {
    "emirates_id": (
        field("id_number", "id_number", "ID number", "رقم الهوية", alt_en="Identity No.",
              decoy_en="Sponsor ID", decoy_ar="هوية الكفيل"),
        *person("name", "Name", "الاسم"),
        field("nationality_en", "text", "Nationality (English)", "الجنسية بالإنجليزية", script="latin",
              alt_en="Citizenship (English)", decoy_en="Previous nationality", decoy_ar="الجنسية السابقة"),
        field("nationality_ar", "text", "Nationality (Arabic)", "الجنسية بالعربية", script="arabic",
              alt_en="Citizenship (Arabic)", decoy_en="Previous nationality (Arabic)", decoy_ar="الجنسية السابقة بالعربية"),
        field("date_of_birth", "date", "Date of birth", "تاريخ الميلاد", alt_en="Birth date",
              decoy_en="Record opened on", decoy_ar="تاريخ فتح السجل"),
        field("sex", "code", "Sex", "الجنس", alt_en="Sex code", decoy_en="Prior record sex", decoy_ar="الجنس في سجل سابق"),
        ISSUE,
        field("expiry_date", "date", "Expiry date", "تاريخ الانتهاء", alt_en="Valid until",
              decoy_en="Card printed on", decoy_ar="تاريخ طباعة البطاقة"),
        field("card_number", "id_number", "Card number", "رقم البطاقة", alt_en="Card No."),
    ),
    "tawtheeq_contract": (
        field("contract_number", "id_number", "Contract number", "رقم العقد", alt_en="Contract No."),
        field("registration_date", "date", "Registration date", "تاريخ التسجيل", alt_en="Registered on",
              decoy_en="Copy printed on", decoy_ar="تاريخ طباعة النسخة"),
        *person("landlord_name", "Landlord", "اسم المؤجر"),
        *person("tenant_name", "Tenant", "اسم المستأجر"),
        field("tenant_id_number", "id_number", "Tenant ID", "هوية المستأجر", alt_en="Tenant identity No.",
              decoy_en="Sponsor ID", decoy_ar="هوية الكفيل"),
        UNIT, PLOT, *district(),
        field("property_usage", "code", "Property usage", "استخدام العقار", alt_en="Permitted use",
              decoy_en="Previous usage", decoy_ar="الاستخدام السابق"),
        field("start_date", "date", "Start date", "تاريخ البداية", alt_en="Commencement date",
              decoy_en="Inspection date", decoy_ar="تاريخ المعاينة"),
        field("end_date", "date", "End date", "تاريخ النهاية", alt_en="Valid through",
              decoy_en="Review date", decoy_ar="تاريخ المراجعة"),
        field("annual_rent", "money", "Annual rent", "الإيجار السنوي", alt_en="Yearly rent",
              decoy_en="Previous rent", decoy_ar="الإيجار السابق"),
        field("security_deposit", "money", "Security deposit", "مبلغ التأمين", alt_en="Deposit amount",
              decoy_en="Previous deposit", decoy_ar="التأمين السابق"),
        field("number_of_cheques", "integer", "Number of cheques", "عدد الشيكات", alt_en="Cheque count",
              decoy_en="Previous cheque count", decoy_ar="عدد الشيكات السابق"),
    ),
    "title_deed": (
        field("deed_number", "id_number", "Deed number", "رقم السند", alt_en="Deed No."),
        ISSUE, *person("owner_name", "Owner", "اسم المالك"),
        field("owner_id_number", "id_number", "Owner ID", "هوية المالك", alt_en="Owner identity No.",
              decoy_en="Sponsor ID", decoy_ar="هوية الكفيل"),
        PLOT, UNIT, *district(),
        field("property_type", "code", "Property type", "نوع العقار", alt_en="Unit category",
              decoy_en="Previous property type", decoy_ar="نوع العقار السابق"),
        field("area_sq_m", "decimal", "Area (sq. m)", "المساحة بالمتر المربع", alt_en="Floor area (sq. m)",
              decoy_en="Adjacent unit area", decoy_ar="مساحة الوحدة المجاورة"),
    ),
}
TITLES = {
    "emirates_id": ("Identity Card (Specimen)", "بطاقة الهوية (عينة)"),
    "tawtheeq_contract": ("Tenancy Contract Registration Certificate (Specimen)", "شهادة تسجيل عقد إيجار (عينة)"),
    "title_deed": ("Title Deed (Specimen)", "سند ملكية (عينة)"),
}
CODE_TEXT = {
    "M": "M / ذكر", "F": "F / أنثى", "RESIDENTIAL": "Residential / سكني",
    "COMMERCIAL": "Commercial / تجاري", "APARTMENT": "Apartment / شقة",
    "VILLA": "Villa / فيلا", "TOWNHOUSE": "Townhouse / منزل متصل", "LAND": "Land / أرض",
}
