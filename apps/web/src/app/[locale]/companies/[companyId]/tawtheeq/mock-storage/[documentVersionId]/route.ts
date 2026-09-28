import { getCurrentSession } from "@/lib/session/session";
import { isSectionPermitted } from "@/lib/navigation/sections";
import { formatMoney, formatDate } from "@/lib/format";
import { getMessages } from "@aqarak/i18n";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import { workflowIsMock } from "../../_lib/client";
import { acceptObject, mockStore } from "../../_lib/mock-store";
interface Context {
  params: Promise<{ companyId: string; documentVersionId: string }>;
}
async function access(
  context: Context,
): Promise<{ sessionId: string; documentId: string } | null> {
  if (!workflowIsMock()) return null;
  const { companyId, documentVersionId } = await context.params;
  if (companyId !== MOCK_COMPANY_A_ID) return null;
  const session = await getCurrentSession();
  const company = session?.me.contexts.find((c) => c.companyId === companyId);
  return session && company && isSectionPermitted(company, "tawtheeq")
    ? { sessionId: session.sessionId, documentId: documentVersionId }
    : null;
}
export async function PUT(
  request: Request,
  context: Context,
): Promise<Response> {
  const grant = await access(context);
  if (!grant) return new Response(null, { status: 403 });
  const object = mockStore(grant.sessionId).objects.get(grant.documentId);
  if (
    object?.sessionId !== grant.sessionId ||
    object.token !== new URL(request.url).searchParams.get("token") ||
    object.expires < Date.now()
  )
    return new Response(null, { status: 403 });
  if (
    request.headers.get("Content-Type") !== object.input.contentType ||
    request.headers.get("x-amz-checksum-sha256") !==
      Buffer.from(object.input.sha256, "hex").toString("base64")
  )
    return new Response(null, { status: 400 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  let reading = true;
  while (reading) {
    const part = await reader.read();
    if (part.done) {
      reading = false;
      continue;
    }
    size += part.value.byteLength;
    if (size > object.input.byteSize) {
      await reader.cancel();
      return new Response(null, { status: 413 });
    }
    chunks.push(part.value);
  }
  const bytes = Buffer.concat(chunks);
  return new Response(null, {
    status: acceptObject(object, bytes) ? 200 : 400,
    headers: { "Cache-Control": "no-store" },
  });
}
function escapeXml(value: string): string {
  return value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char] ?? char,
  );
}
export async function GET(
  request: Request,
  context: Context,
): Promise<Response> {
  const grant = await access(context);
  if (!grant) return new Response(null, { status: 403 });
  const object = mockStore(grant.sessionId).objects.get(grant.documentId);
  if (object) {
    if (
      object.sessionId !== grant.sessionId ||
      object.token !== new URL(request.url).searchParams.get("token") ||
      object.expires < Date.now() ||
      object.rejected ||
      !object.bytes
    )
      return new Response(null, { status: 403 });
    return new Response(Buffer.from(object.bytes), {
      headers: {
        "Content-Type": object.input.contentType,
        "Cache-Control": "no-store",
        "Content-Disposition": 'inline; filename="synthetic-certificate"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  const record = mockStore(grant.sessionId).records.get(
    new URL(request.url).searchParams.get("record") ?? "",
  );
  if (record?.document?.documentVersionId !== grant.documentId)
    return new Response(null, { status: 404 });
  const t = getMessages("en").Tawtheeq;
  const certificateFields = [
    {
      field: "tawtheeq_number" as const,
      registeredValue: record.tawtheeqNumber,
    },
    { field: "registered_on" as const, registeredValue: record.registeredOn },
    ...record.comparison,
  ];
  const rows = certificateFields
    .map((row, i) => {
      const value = row.registeredValue;
      const printed =
        value === null
          ? t.unknown
          : row.field.endsWith("_fils")
            ? formatMoney(Number(value), "en")
            : ["term_start", "term_end", "registered_on"].includes(row.field)
              ? formatDate(String(value), "en")
              : String(value);
      return `<text x="32" y="${String(130 + i * 45)}" font-size="16">${escapeXml(t.fields[row.field])}: ${escapeXml(printed)}</text>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 720"><title>${t.syntheticCertificate}</title><text x="32" y="45" font-size="24">${t.syntheticCertificate}</text><text x="32" y="82" font-size="18">${escapeXml(record.contract.contractNo)}</text>${rows}</svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-store",
      "Content-Disposition": 'inline; filename="synthetic-certificate.svg"',
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
